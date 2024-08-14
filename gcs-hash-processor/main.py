import os
import hashlib
import json
import threading
import uuid
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from google.cloud import storage
from flask import Flask, request, jsonify
from collections import defaultdict
from datetime import datetime

app = Flask(__name__)

# Thread-local storage
thread_local = threading.local()

BUCKET_NAME = "bacteria-collection-data"

def get_storage_client():
    if not hasattr(thread_local, "client"):
        thread_local.client = storage.Client()
    return thread_local.client


def calculate_file_hash(blob):
    hash_md5 = hashlib.md5()
    temp_file = f'/tmp/{uuid.uuid4().hex}'
    try:
        blob.download_to_filename(temp_file)
        with open(temp_file, 'rb') as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
    finally:
        if os.path.exists(temp_file):
            os.remove(temp_file)
    return hash_md5.hexdigest()


def process_file(bucket_name, blob_name):
    client = get_storage_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)

    # Check if file already has a hash
    if blob.metadata and 'file_hash' in blob.metadata:
        print(f'Skipping file: {blob.name} (already processed)')
        return None, blob.name

    print(f'Processing file: {blob.name}')
    file_hash = calculate_file_hash(blob)

    # Update blob metadata
    metadata = {
        'file_hash': file_hash,
        'name': blob.name,
        'bucket': bucket_name,
        'size': str(blob.size) if blob.size is not None else 'unknown',
        'content_type': blob.content_type if blob.content_type is not None else 'unknown',
        'updated': blob.updated.isoformat() if blob.updated is not None else datetime.now().isoformat(),
        'md5_hash': blob.md5_hash if blob.md5_hash is not None else 'unknown',
        'processed': 'true'
    }
    blob.metadata = metadata
    blob.patch()

    return file_hash, blob.name


def process_all_files(bucket_name, num_threads=10):
    client = get_storage_client()
    bucket = client.bucket(bucket_name)
    blobs = list(bucket.list_blobs())

    # Filter out blobs that already have a hash
    blobs_to_process = [blob for blob in blobs if not (blob.metadata and 'file_hash' in blob.metadata)]

    total_files = len(blobs_to_process)
    print(f"Starting processing of {total_files} files out of {len(blobs)} total files")

    results = []
    processed_count = 0
    with ThreadPoolExecutor(max_workers=num_threads) as executor:
        future_to_blob = {executor.submit(process_file, bucket_name, blob.name): blob for blob in blobs_to_process}

        for future in as_completed(future_to_blob):
            blob = future_to_blob[future]
            try:
                file_hash, file_name = future.result()
                processed_count += 1
                if file_hash is not None:
                    results.append((file_hash, file_name))
                print(f"Processed {processed_count}/{total_files} FileName:{file_name} with Hash: {file_hash}")
            except Exception as exc:
                print(f'{blob.name} generated an exception: {exc}')

    return results, processed_count, total_files


def remove_file_hash_metadata(bucket_name, blob_name):
    client = get_storage_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)

    metadata = blob.metadata
    del metadata['file_hash']
    del metadata['processed']
    del metadata['md5_hash']
    blob.metadata = metadata
    blob.patch()
    return True


@app.route('/pubsub', methods=['POST'])
def pubsub_trigger():
    envelope = request.get_json()
    if not envelope:
        msg = 'no Pub/Sub message received'
        print(f'error: {msg}')
        return f'Bad Request: {msg}', 400

    if not isinstance(envelope, dict) or 'message' not in envelope:
        msg = 'invalid Pub/Sub message format'
        print(f'error: {msg}')
        return f'Bad Request: {msg}', 400

    pubsub_message = envelope['message']

    if isinstance(pubsub_message, dict) and 'data' in pubsub_message:
        try:
            data = json.loads(base64.b64decode(pubsub_message['data']).decode('utf-8'))
        except Exception as e:
            msg = f'Invalid Pub/Sub message data: {e}'
            print(f'error: {msg}')
            return f'Bad Request: {msg}', 400

        bucket_name = data.get('bucket', BUCKET_NAME)
        file_name = data.get('name')
        process_all = data.get('process_all', False)

        if not bucket_name:
            msg = 'Pub/Sub message missing bucket name'
            print(f'error: {msg}')
            return f'Bad Request: {msg}', 400

        try:
            if process_all:
                results = process_all_files(bucket_name)
                return jsonify({
                    'status': 'success',
                    'files_processed': len(results)
                }), 200
            elif file_name:
                file_hash, processed_name = process_file(bucket_name, file_name)
                if file_hash:
                    return jsonify({
                        'status': 'success',
                        'file_processed': processed_name,
                        'file_hash': file_hash
                    }), 200
                else:
                    return jsonify({
                        'status': 'skipped',
                        'file_skipped': processed_name
                    }), 200
            else:
                msg = 'Pub/Sub message missing file name and process_all flag'
                print(f'error: {msg}')
                return f'Bad Request: {msg}', 400
        except Exception as e:
            msg = f'Error processing file(s): {str(e)}'
            print(f'error: {msg}')
            return f'Internal Server Error: {msg}', 500

    msg = 'invalid Pub/Sub message format'
    print(f'error: {msg}')
    return f'Bad Request: {msg}', 400


@app.route('/get-bucket-stats', methods=['GET'])
def get_bucket_stats():
    bucket_name = request.args.get('bucket', BUCKET_NAME)
    if not bucket_name:
        return jsonify({'error': 'Bucket name is required'}), 400

    client = get_storage_client()
    bucket = client.bucket(bucket_name)
    blobs = list(bucket.list_blobs())
    total_count = len(blobs)

    # Count files with and without file_hash metadata
    files_with_hash = sum(1 for blob in blobs if blob.metadata and 'file_hash' in blob.metadata)
    files_without_hash = total_count - files_with_hash

    return jsonify({
        'total_files': total_count,
        'files_with_hash': files_with_hash,
        'files_without_hash': files_without_hash
    }), 200


@app.route('/find-identical-files', methods=['GET'])
def find_identical_files():
    bucket_name = request.args.get('bucket', BUCKET_NAME)
    if not bucket_name:
        return jsonify({'error': 'Bucket name is required'}), 400

    client = get_storage_client()
    bucket = client.bucket(bucket_name)
    blobs = bucket.list_blobs()

    # Group files by hash, size, and name
    file_groups = defaultdict(list)
    for blob in blobs:
        if blob.metadata and 'file_hash' in blob.metadata:
            file_hash = blob.metadata['file_hash']
            file_size = blob.metadata['size']
            file_name = os.path.basename(blob.name)
            file_groups[(file_hash, file_size)].append({
                'name': blob.name,
                'size': file_size,
                'hash': file_hash
            })

    # Organize results
    results = {
        'identical_content_and_name': [],
        'identical_content_different_name': [],
        'identical_name_different_content': []
    }

    counts = {
        'identical_content_and_name': 0,
        'identical_content_different_name': 0,
        'identical_name_different_content': 0,
        'total_duplicate_count': 0
    }

    for (file_hash, file_size), files in file_groups.items():
        if len(files) > 1:
            # Check for identical content (hash and size) and name
            name_groups = defaultdict(list)
            for file in files:
                name_groups[os.path.basename(file['name'])].append(file)

            for name, group in name_groups.items():
                if len(group) > 1:
                    results['identical_content_and_name'].append(group)
                    counts['identical_content_and_name'] += len(group) - 1
                    counts['total_duplicate_count'] += len(group) - 1
                elif len(files) > len(group):
                    results['identical_content_different_name'].append(files)
                    counts['identical_content_different_name'] += len(files) - 1
                    counts['total_duplicate_count'] += len(files) - 1

    # Check for identical names with different content
    name_groups = defaultdict(list)
    for blob in blobs:
        if blob.metadata and 'file_hash' in blob.metadata:
            name_groups[os.path.basename(blob.name)].append({
                'name': blob.name,
                'size': blob.metadata['size'],
                'hash': blob.metadata['file_hash']
            })

    for name, group in name_groups.items():
        if len(group) > 1 and len(set((file['hash'], file['size']) for file in group)) > 1:
            results['identical_name_different_content'].append(group)
            counts['identical_name_different_content'] += len(group) - 1
            counts['total_duplicate_count'] += len(group) - 1

    # Add counts to results
    results['counts'] = counts

    return jsonify(results), 200


@app.route('/get-file-metadata', methods=['GET'])
def get_file_metadata():
    bucket_name = request.args.get('bucket', BUCKET_NAME)
    file_name = request.args.get('file')
    if not bucket_name or not file_name:
        return jsonify({'error': 'Both bucket and file name are required'}), 400

    client = get_storage_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(file_name)

    if not blob.exists():
        return jsonify({'error': 'File not found'}), 404

    if blob.metadata:
        return jsonify(blob.metadata), 200
    else:
        return jsonify({'error': 'No metadata found for this file'}), 404


@app.route('/remove-all-file-hash-metadata', methods=['GET'])
def remove_all_file_hash_metadata():
    bucket_name = request.args.get('bucket', BUCKET_NAME)
    num_threads = request.args.get('num_threads', 10)  # Default to 10 threads if not specified

    if not bucket_name:
        return jsonify({'error': 'Bucket name is required'}), 400

    client = get_storage_client()
    bucket = client.bucket(bucket_name)
    blobs = list(bucket.list_blobs())

    processed_count = 0
    removed_count = 0

    with ThreadPoolExecutor(max_workers=num_threads) as executor:
        future_to_blob = {executor.submit(remove_file_hash_metadata, bucket_name, blob.name): blob for blob in blobs}

        for future in as_completed(future_to_blob):
            blob = future_to_blob[future]
            try:
                result = future.result()
                processed_count += 1
                if result:
                    removed_count += 1
                if processed_count % 100 == 0:
                    print(f"Processed {processed_count} files, removed metadata from {removed_count} files")
            except Exception as exc:
                print(f'{blob.name} generated an exception: {exc}')

    return jsonify({
        'status': 'success',
        'total_files_processed': processed_count,
        'files_with_metadata_removed': removed_count
    }), 200


def compare_files_md5(bucket_name):
    client = get_storage_client()
    bucket = client.bucket(bucket_name)
    blobs = list(bucket.list_blobs())

    md5_groups = defaultdict(list)
    for blob in blobs:
        if blob.md5_hash:
            md5_groups[blob.md5_hash].append({
                'name': blob.name,
                'size': blob.size,
                'updated': blob.updated.isoformat() if blob.updated else None,
                'content_type': blob.content_type
            })

    unique_files = []
    duplicate_groups = []

    for md5_hash, files in md5_groups.items():
        if len(files) == 1:
            unique_files.append(files[0])
        else:
            duplicate_groups.append(files)

    return {
        'duplicate_groups': duplicate_groups,
        'total_files': len(blobs),
        'unique_count': len(unique_files),
        'duplicate_count': sum(len(group) for group in duplicate_groups)
    }


@app.route('/compare-files-md5', methods=['GET'])
def compare_files_md5_endpoint():
    bucket_name = request.args.get('bucket') or BUCKET_NAME

    if not bucket_name:
        return jsonify({'error': 'Bucket name is required'}), 400

    try:
        result = compare_files_md5(bucket_name)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get('PORT', 8080))
    app.run(debug=False, host='0.0.0.0', port=port)
