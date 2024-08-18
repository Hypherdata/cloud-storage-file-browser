const vision = require('@google-cloud/vision');
const {Storage} = require('@google-cloud/storage');
const path = require('path');
const { Parser } = require('json2csv');

const imageAnnotatorClient = new vision.ImageAnnotatorClient();
const productSearchClient = new vision.ProductSearchClient();
const storage = new Storage();

const projectId = process.env.PROJECT_ID;
const location = process.env.LOCATION;
const productSetId = process.env.PRODUCT_SET_ID;
const bucketName = process.env.BUCKET_NAME;
const resultsBucketName = process.env.RESULTS_BUCKET || bucketName;
const similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD || '0.7');

async function listImagesInBucket(bucketName) {
  const [files] = await storage.bucket(bucketName).getFiles();
  return files
    .filter(file => file.name.toLowerCase().endsWith('.png'))
    .map(file => ({
      name: file.name,
      gcsUri: `gs://${bucketName}/${file.name}`
    }));
}

async function findSimilarImages(imagePath) {
  const productSetPath = `projects/${projectId}/locations/${location}/productSets/${productSetId}`;

  const request = {
    image: {source: {imageUri: imagePath}},
    features: [{type: 'PRODUCT_SEARCH'}],
    imageContext: {
      productSearchParams: {
        productSet: productSetPath,
        productCategories: ['general-v1'],
        filter: ''
      }
    }
  };

  try {
    console.log(`Searching for similar images to: ${imagePath}`);
    const [response] = await imageAnnotatorClient.annotateImage(request);
    if (!response.productSearchResults || !response.productSearchResults.results) {
      console.warn(`No product search results found for image: ${imagePath}`);
      return [];
    }
    return response.productSearchResults.results;
  } catch (error) {
    console.error('Error in findSimilarImages:', error);
    throw error;
  }
}

async function compareBucketImages(imageFiles) {
  const comparisonResults = [];

  for (let i = 0; i < imageFiles.length; i++) {
    const baseImage = imageFiles[i];
    try {
      console.log(`Comparing image ${i + 1}/${imageFiles.length}: ${baseImage.name}`);
      const similarImages = await findSimilarImages(baseImage.gcsUri);

      const processedResults = similarImages.map(result => ({
        baseImage: baseImage.name,
        similarImage: result.product.displayName,
        folder: path.dirname(baseImage.name),
        score: result.score
      })).filter(result => result.baseImage !== result.similarImage);

      console.log(`Found ${processedResults.length} similar images`);
      console.log(processedResults);

      comparisonResults.push(...processedResults);
    } catch (error) {
      console.error(`Error comparing image ${baseImage.name}:`, error);
    }
  }

  return comparisonResults;
}

async function saveResults(results) {
  const fileName = `image_comparison_results_${Date.now()}.json`;
  await storage.bucket(resultsBucketName).file(fileName).save(JSON.stringify(results));
  console.log(`Results saved to gs://${resultsBucketName}/${fileName}`);
  return fileName;
}

async function generateCSV(data) {
  if (data.length === 0) {
    console.warn('No data to generate CSV');
    return '';
  }
  const fields = Object.keys(data[0]);
  const json2csvParser = new Parser({ fields });
  return json2csvParser.parse(data);
}

async function main() {
  try {
    console.log('Starting image comparison job');
    const imageFiles = await listImagesInBucket(bucketName);
    console.log(`Found ${imageFiles.length} images to compare`);

    const comparisonResults = await compareBucketImages(imageFiles);
    console.log(`Comparison completed. ${comparisonResults.length} results found`);

    // Filter results based on similarity threshold
    const filteredResults = comparisonResults.filter(result => result.score >= similarityThreshold);

    // full report
    const csv = await generateCSV(comparisonResults);
    const resultsBucketName = process.env.RESULTS_BUCKET || bucketName;
    const fileName = `image_comparison_${Date.now()}_full.csv`;
    const file = storage.bucket(resultsBucketName).file(fileName);
    await file.save(csv);

    console.log(`Full results saved to: gs://${resultsBucketName}/${fileName}`);
    const result = {
      message: "Images listed and compared successfully",
      imageCount: imageFiles.length,
      comparisonCount: filteredResults.length,
      //csvUrl,
      images: imageFiles,
      comparisons: filteredResults,
      totalComparisons: comparisonResults.length
    }
    console.log(result);

    const resultFileName = await saveResults(filteredResults);

    console.log('Job completed successfully');
    console.log(`Full results saved to: gs://${resultsBucketName}/${resultFileName}`);
  } catch (error) {
    console.error('Job failed:', error);
    process.exit(1);
  }
}

main();
