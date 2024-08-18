import os
import io
import json
from datetime import datetime
import numpy as np
from flask import Flask, request, jsonify
from google.cloud import storage
from skimage.metrics import structural_similarity as ssim
import tifffile
import logging

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Initialize Google Cloud Storage client
storage_client = storage.Client()

def list_tif_files(bucket_name):
    """List all TIF files in the specified bucket."""
    logging.info(f"Listing TIF files in bucket: {bucket_name}")
    bucket = storage_client.bucket(bucket_name)
    tif_files = [blob for blob in bucket.list_blobs() if blob.name.lower().endswith('.tif')]
    logging.info(f"Found {len(tif_files)} TIF files in the bucket")
    return tif_files

def get_file_metadata(blob):
    """Extract metadata from a blob."""
    logging.info(f"Extracting metadata for file: {blob.name}")
    metadata = {
        "full_path": blob.name,
        "size": blob.size,
        "content_type": blob.content_type,
        "created": blob.time_created.isoformat() if blob.time_created else None,
        "updated": blob.updated.isoformat() if blob.updated else None,
        "md5_hash": blob.md5_hash,
        "custom_metadata": blob.metadata
    }
    logging.debug(f"Metadata for {blob.name}: {metadata}")
    return metadata

def download_tif_from_bucket(blob):
    """Download a TIF file from a GCS bucket and return it as a numpy array."""
    logging.info(f"Downloading TIF file: {blob.name}")
    buffer = io.BytesIO()
    blob.download_to_file(buffer)
    buffer.seek(0)

    with tifffile.TiffFile(buffer) as tif:
        array = tif.asarray()
    logging.info(f"Downloaded {blob.name}. Shape: {array.shape}, dtype: {array.dtype}")
    return array

def calculate_ssim(img1, img2):
    """Calculate SSIM between two images, handling small images."""
    min_dim = min(img1.shape[0], img1.shape[1], img2.shape[0], img2.shape[1])

    if min_dim < 7:
        logging.warning(f"Image too small for default SSIM. Using win_size={min_dim}")
        win_size = min_dim if min_dim % 2 != 0 else min_dim - 1
    else:
        win_size = 7  # default win_size

    logging.info(f"Calculating SSIM with win_size={win_size}")
    return ssim(img1, img2, data_range=img1.max() - img1.min(), multichannel=True, win_size=win_size)

def compare_tif_images(img1, img2, name1, name2):
    """Compare two TIF images using SSIM."""
    logging.info(f"Comparing images: {name1} vs {name2}")
    if img1.shape != img2.shape:
        logging.warning(f"Images have different dimensions. {name1}: {img1.shape}, {name2}: {img2.shape}")
        return {"error": "Images have different dimensions."}

    try:
        ssim_value = calculate_ssim(img1, img2)
        logging.info(f"SSIM value for {name1} vs {name2}: {ssim_value}")
        return {"ssim": ssim_value}
    except Exception as e:
        logging.error(f"Error in SSIM calculation for {name1} vs {name2}: {str(e)}")
        return {"error": f"SSIM calculation failed: {str(e)}"}

def generate_similarity_report(bucket_name, similarity_threshold=0.9):
    """Generate a similarity report for all TIF files in the bucket."""
    logging.info(f"Generating similarity report for bucket: {bucket_name}")
    logging.info(f"Similarity threshold: {similarity_threshold}")

    tif_blobs = list_tif_files(bucket_name)
    report = {
        "metadata": {},
        "comparisons": {}
    }

    logging.info("Gathering metadata for all files")
    for blob in tif_blobs:
        report["metadata"][blob.name] = get_file_metadata(blob)

    total_comparisons = len(tif_blobs) * (len(tif_blobs) - 1) // 2
    logging.info(f"Total comparisons to be made: {total_comparisons}")
    completed_comparisons = 0

    for i, blob1 in enumerate(tif_blobs):
        logging.info(f"Processing file {i+1}/{len(tif_blobs)}: {blob1.name}")
        img1 = download_tif_from_bucket(blob1)
        for blob2 in tif_blobs[i+1:]:
            completed_comparisons += 1
            logging.info(f"Comparison {completed_comparisons}/{total_comparisons}: {blob1.name} vs {blob2.name}")

            try:
                img2 = download_tif_from_bucket(blob2)
                comparison = compare_tif_images(img1, img2, blob1.name, blob2.name)

                if "ssim" in comparison and comparison["ssim"] >= similarity_threshold:
                    logging.info(f"SSIM value {comparison['ssim']} meets threshold. Adding to report.")
                    report["comparisons"][f"{blob1.name} vs {blob2.name}"] = comparison
                elif "error" in comparison:
                    logging.warning(f"Error in comparison: {comparison['error']}")
                    report["comparisons"][f"{blob1.name} vs {blob2.name}"] = comparison
                else:
                    logging.info(f"SSIM value {comparison.get('ssim')} below threshold. Skipping.")
            except Exception as e:
                logging.error(f"Error comparing {blob1.name} and {blob2.name}: {str(e)}")
                report["comparisons"][f"{blob1.name} vs {blob2.name}"] = {"error": str(e)}

    logging.info("Similarity report generation complete")
    return report

def save_report_to_bucket(bucket_name, report, report_filename):
    """Save the JSON report to the bucket."""
    logging.info(f"Saving report to bucket: {bucket_name}, filename: {report_filename}")
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(report_filename)
    report_json = json.dumps(report, indent=2)
    blob.upload_from_string(report_json, content_type="application/json")
    report_url = f"gs://{bucket_name}/{report_filename}"
    logging.info(f"Report saved successfully. URL: {report_url}")
    return report_url

@app.route('/analyze', methods=['POST'])
def analyze_bucket():
    logging.info("Received analyze request")
    data = request.json
    bucket_name = data.get('bucket_name')
    similarity_threshold = data.get('similarity_threshold', 0.9)
    report_filename = data.get('report_filename', f"similarity_report_{datetime.now().isoformat()}.json")

    logging.info(f"Request parameters: bucket_name={bucket_name}, similarity_threshold={similarity_threshold}, report_filename={report_filename}")

    if not bucket_name:
        logging.error("Missing required parameter: bucket_name")
        return jsonify({"error": "bucket_name is required"}), 400

    try:
        logging.info("Starting similarity report generation")
        report = generate_similarity_report(bucket_name, similarity_threshold)
        logging.info("Similarity report generated successfully")

        logging.info("Saving report to bucket")
        report_url = save_report_to_bucket(bucket_name, report, report_filename)
        logging.info("Report saved successfully")

        return jsonify({
            "message": "Analysis complete",
            "report_url": report_url
        }), 200
    except Exception as e:
        logging.error(f"Error in analysis: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/health', methods=['GET'])
def health_check():
    logging.info("Health check requested")
    return jsonify({"status": "healthy"}), 200

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    logging.info(f"Starting application on port {port}")
    app.run(debug=False, host="0.0.0.0", port=port)
