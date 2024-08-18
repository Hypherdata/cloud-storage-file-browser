const express = require('express');
const { Storage } = require('@google-cloud/storage');
const vision = require('@google-cloud/vision');
const {v2} = require('@google-cloud/run');

const { Parser } = require('json2csv');
const sharp = require('sharp');
const path = require('path');
const pLimit = require('p-limit');

const app = express();
const storage = new Storage();
const imageAnnotatorClient = new vision.ImageAnnotatorClient();
const productSearchClient = new vision.ProductSearchClient();
const jobsClient = new v2.JobsClient();

const projectId = process.env.PROJECT_ID || 'hypherdata-cloud-prod';
const location = process.env.LOCATION || 'us-west1';
const productSetId = process.env.PRODUCT_SET_ID || 'productset-bacteria-collection-data';

console.log(`Using Project ID: ${projectId}`);
console.log(`Using Location: ${location}`);
console.log(`Using Product Set ID: ${productSetId}`);

async function createProductSet() {
  const formattedParent = productSearchClient.locationPath(projectId, location);
  const productSet = {
    displayName: productSetId,
  };

  try {
    const [createdProductSet] = await productSearchClient.createProductSet({
      parent: formattedParent,
      productSet: productSet,
      productSetId: productSetId,
    });
    console.log(`Product Set created: ${createdProductSet.name}`);
  } catch (error) {
    if (error.code === 6) {  // ALREADY_EXISTS
      console.log(`Product Set ${productSetId} already exists.`);
    }
  }
}

function generateProductId(filePath) {
  //return filePath.replace(/\//g, '_').replace(/ /g, '_').replace(/\./g, '_');
  const filename = path.basename(filePath);
  return filename.replace(/\.[^/.]+$/, '');  // Remove file extension
}

async function addProductToSet(filePath, imageUri) {
  const formattedParent = productSearchClient.locationPath(projectId, location);
  const productId = generateProductId(filePath); // can be 128 bytes max
  const product = {
    displayName: filePath,
    productCategory: 'general-v1',
  };

  try {
    // Create product
    const [createdProduct] = await productSearchClient.createProduct({
      parent: formattedParent,
      product: product,
      productId: productId,
    });
    console.log(`Product created: ${createdProduct.name}`);

    // Add product to product set
    const formattedName = productSearchClient.productSetPath(projectId, location, productSetId);
    console.log("formattedName:", formattedName);
    await productSearchClient.addProductToProductSet({
      name: formattedName,
      product: createdProduct.name,
    });
    console.log(`Product ${productId} added to Product Set ${productSetId}`);

    // Add reference image to product
    const formattedProduct = productSearchClient.productPath(projectId, location, productId);
    const referenceImage = {
      uri: imageUri,
    };
    const [response] = await productSearchClient.createReferenceImage({
      parent: formattedProduct,
      referenceImage: referenceImage,
    });
    console.log(`Reference image added to product ${productId}: ${response.name}`);
  } catch (error) {
    console.error(`Error adding product ${productId} to set:`, error);
  }
}

async function verifyProductSet() {
  const productSetPath = productSearchClient.productSetPath(projectId, location, productSetId);

  try {
    const [productSet] = await productSearchClient.getProductSet({ name: productSetPath });
    console.log(`Product Set exists: ${productSet.name}`);

    const [products] = await productSearchClient.listProductsInProductSet({ name: productSetPath });
    console.log(`Number of products in the Product Set: ${products.length}`);

    return products.length > 0;
  } catch (error) {
    if (error.code === 5) {  // NOT_FOUND
      console.log(`Product Set ${productSetId} not found. Creating it.`);
      await createProductSet();
      return false;
    } else {
      console.error('Error verifying Product Set:', error);
      throw error;
    }
  }
}

async function convertTifToPng(sourceBucketName, sourceFileName) {
  console.log(`Converting TIF to PNG: ${sourceFileName}`);
  const sourceBucket = storage.bucket(sourceBucketName);
  const destinationBucket = storage.bucket("bacteria-collection-data-png");
  const sourceFile = sourceBucket.file(sourceFileName);
  const pngFileName = sourceFileName.replace(/\.tif$/i, '.png');
  const destinationFile = destinationBucket.file(pngFileName);

  // Check if the PNG file already exists
  const [exists] = await destinationFile.exists();
  if (exists) {
    console.log(`PNG file already exists for ${sourceFileName}, skipping conversion`);
    return `gs://${destinationBucket.name}/${pngFileName}`;
  }

  try {
    const [buffer] = await sourceFile.download();
    const pngBuffer = await sharp(buffer).png().toBuffer();
    await destinationFile.save(pngBuffer);

    console.log(`Converted ${sourceFileName} to PNG and stored as ${pngFileName}`);
    return `gs://${destinationBucket.name}/${pngFileName}`;
  } catch (error) {
    console.error(`Error converting ${sourceFileName} to PNG:`, error);
    return null;
  }
}

async function convertAllTifToPng(sourceBucketName) {
  const [files] = await storage.bucket(sourceBucketName).getFiles();
  const tifFiles = files.filter(file => file.name.toLowerCase().endsWith('.tif'));

  const batchSize = 10; // Process 10 files at a time
  const concurrencyLimit = 5; // Allow 5 concurrent conversions
  const limit = pLimit(concurrencyLimit);

  const convertBatch = async (batch) => {
    return Promise.all(batch.map(file => limit(() => convertTifToPng(sourceBucketName, file.name))));
  };

  const results = [];
  for (let i = 0; i < tifFiles.length; i += batchSize) {
    const batch = tifFiles.slice(i, i + batchSize);
    const batchResults = await convertBatch(batch);
    results.push(...batchResults.filter(result => result !== null));
    console.log(`Converted batch ${i / batchSize + 1} of ${Math.ceil(tifFiles.length / batchSize)}`);
  }

  return results;
}

async function listImagesInBucket(bucketName) {
  console.log(`Listing images in bucket: ${bucketName}`);
  const [files] = await storage.bucket(bucketName).getFiles();

  // Filter PNG files
  const pngFiles = files.filter(file => file.name.toLowerCase().endsWith('.png'));
  const imageFiles = await Promise.all(pngFiles.map(async (file) => {
    return {
      name: file.name,
      contentType: file.metadata.contentType,
      size: parseInt(file.metadata.size),
      updated: file.metadata.updated,
      gcsUri: `gs://${bucketName}/${file.name}`
    };
  }));

  console.log(`Found ${imageFiles.length} PNG images`);
  return imageFiles;
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
    console.log('Annotate Image Response:', JSON.stringify(response, null, 2));

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

      comparisonResults.push(...processedResults);
    } catch (error) {
      console.error(`Error comparing image ${baseImage.name}:`, error);
    }
  }

  return comparisonResults;
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

async function deleteAllProducts() {
  const formattedParent = productSearchClient.locationPath(projectId, location);

  try {
    const [allProducts] = await productSearchClient.listProducts({
      parent: formattedParent
    });

    console.log(`Found ${allProducts.length} products to delete.`);

    // Delete each product
    for (const product of allProducts) {
      await productSearchClient.deleteProduct({ name: product.name });
      console.log(`Deleted product: ${product.name}`);
    }

    console.log('All products have been deleted from the Product Set.');
  } catch (error) {
    console.error('Error deleting products:', error);
    throw error;
  }
}

app.use(express.json());

app.post('/convert-tif-to-png', async (req, res) => {
  try {
    const { bucketName } = req.body;

    if (!bucketName) {
      return res.status(400).json({ error: 'Bucket name is required' });
    }

    console.log(`Converting TIF files in bucket: ${bucketName}`);
    const convertedFiles = await convertAllTifToPng(bucketName);

    res.json({
      message: 'TIF to PNG conversion completed successfully',
      convertedFiles: convertedFiles,
      totalConverted: convertedFiles.length
    });
  } catch (error) {
    console.error('Error converting TIF to PNG:', error);
    res.status(500).json({ error: 'An error occurred while converting TIF to PNG', details: error.message });
  }
});

app.post('/setup-product-set', async (req, res) => {
  try {
    const { bucketName } = req.body;

    if (!bucketName) {
      return res.status(400).json({ error: 'Bucket name is required' });
    }

    await createProductSet();

//    console.log(`Converting TIF files in bucket: ${bucketName}`);
//    await convertAllTifToPng(bucketName);

    const imageFiles = await listImagesInBucket(bucketName);
    const imageFilesDescending = imageFiles.sort((a, b) => b.size - a.size);

    for (const image of imageFilesDescending) {
      let n = imageFiles.indexOf(image) + 1;
      console.log(`Adding image ${n} of ${imageFiles.length} to Product Set: ${image.name}`);
      await addProductToSet(image.name, image.gcsUri);
    }

    res.json({ message: 'Product Set setup completed successfully' });
  } catch (error) {
    console.error('Error setting up Product Set:', error);
    res.status(500).json({ error: 'An error occurred while setting up the Product Set', details: error.message });
  }
});

app.post('/list-and-compare-images', async (req, res) => {
  try {
    const isProductSetValid = await verifyProductSet();
    if (!isProductSetValid) {
      return res.status(400).json({ error: 'Product Set is not properly set up or is empty' });
    }

    const { bucketName, generateCsv, similarityThreshold = 0.9 } = req.body;

    if (!bucketName) {
      return res.status(400).json({ error: 'Bucket name is required' });
    }

    console.log(`Processing bucket: ${bucketName}`);
    const imageFiles = await listImagesInBucket(bucketName);

    if (imageFiles.length === 0) {
      return res.status(404).json({ error: 'No images found in the specified bucket' });
    }

    const comparisonResults = await compareBucketImages(imageFiles);
    console.log(`Comparison completed. ${comparisonResults.length} results found`);

    // Filter results based on similarity threshold
    const filteredResults = comparisonResults.filter(result => result.score >= similarityThreshold);

    let csvUrl;
    if (generateCsv && filteredResults.length > 0) {
      const csv = await generateCSV(filteredResults);
      const resultsBucketName = process.env.RESULTS_BUCKET || bucketName;
      const fileName = `image_comparison_${Date.now()}.csv`;
      const file = storage.bucket(resultsBucketName).file(fileName);

      await file.save(csv);

      // [csvUrl] = await file.getSignedUrl({
      //   action: 'read',
      //   expires: Date.now() + 15 * 60 * 1000, // URL expires in 15 minutes
      // });
    }

    // full report
    const csv = await generateCSV(comparisonResults);
    const resultsBucketName = process.env.RESULTS_BUCKET || bucketName;
    const fileName = `image_comparison_${Date.now()}_full.csv`;
    const file = storage.bucket(resultsBucketName).file(fileName);
    await file.save(csv);

    res.json({
      message: "Images listed and compared successfully",
      imageCount: imageFiles.length,
      comparisonCount: filteredResults.length,
      //csvUrl,
      images: imageFiles,
      comparisons: filteredResults,
      totalComparisons: comparisonResults.length
    });
  } catch (error) {
    console.error('Error listing and comparing images:', error);
    res.status(500).json({ error: 'An error occurred while listing and comparing images', details: error.message });
  }
});

app.post('/delete-all-products', async (req, res) => {
  try {
    await deleteAllProducts();
    res.json({ message: 'All products have been deleted from the Product Set' });
  } catch (error) {
    console.error('Error deleting all products:', error);
    res.status(500).json({ error: 'An error occurred while deleting products', details: error.message });
  }
});

app.post('/list-and-compare-images-job', async (req, res) => {
  try {
    const { bucketName, similarityThreshold = 0.7 } = req.body;

    if (!bucketName) {
      return res.status(400).json({ error: 'Bucket name is required' });
    }

    const jobConfig = {
      template: {
        containers: [{
          image: 'gcr.io/hypherdata-cloud-prod/job-compare-images:latest',
          env: [
            { name: 'BUCKET_NAME', value: bucketName },
            { name: 'PROJECT_ID', value: projectId },
            { name: 'LOCATION', value: location },
            { name: 'PRODUCT_SET_ID', value: productSetId },
            { name: 'SIMILARITY_THRESHOLD', value: similarityThreshold.toString() },
            { name: 'IS_JOB', value: 'true' },
            { name: 'JOB_TYPE', value: 'compare' }
          ]
        }]
      }
    };

    const job = await createCloudRunJob(jobConfig);

    res.json({
      message: 'Image comparison job started successfully',
      jobName: job.name
    });
  } catch (error) {
    console.error('Error starting image comparison job:', error);
    res.status(500).json({ error: 'An error occurred while starting the image comparison job', details: error.message });
  }
});

async function createCloudRunJob(jobConfig) {
  const request = {
    parent: `projects/${projectId}/locations/${location}`,
    jobId: `job-compare-images-${Date.now()}`,
    job: {
      template: {
        template: {
          containers: jobConfig.template.containers,
          executionEnvironment: 'EXECUTION_ENVIRONMENT_GEN2',
        }
      },
    },
  };

  try {
    const [operation] = await jobsClient.createJob(request);
    const [job] = await operation.promise();
    console.log(`Job created successfully: ${job.name}`);
    return job;
  } catch (error) {
    console.error('Error creating Cloud Run job:', error);
    throw error;
  }
}

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
