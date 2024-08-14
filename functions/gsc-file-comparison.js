const crypto = require('crypto');
const { Storage } = require('@google-cloud/storage');
const { EventEmitter } = require('events');

const storage = new Storage();

async function getFileHash(bucket, fileName) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    bucket.file(fileName).createReadStream()
      .on('error', reject)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

class FileComparisonEmitter extends EventEmitter {}

async function findIdenticalFiles(bucketName, batchSize = 100) {
  const bucket = storage.bucket(bucketName);
  const [files] = await bucket.getFiles();

  const fileHashes = {};
  const identicalFiles = {};
  const emitter = new FileComparisonEmitter();

  const totalFiles = files.length;
  let processedFiles = 0;

  console.log(`Processing ${totalFiles} files...`);

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);

    await Promise.all(batch.map(async (file) => {
      const hash = await getFileHash(bucket, file.name);
      console.log(`File: ${file.name}, Hash: ${hash}`);

      if (fileHashes[hash]) {
        if (!identicalFiles[hash]) {
          identicalFiles[hash] = [fileHashes[hash]];
        }
        identicalFiles[hash].push(file.name);
      } else {
        fileHashes[hash] = file.name;
      }

      processedFiles++;
      emitter.emit('progress', {
        processedFiles,
        totalFiles,
        percentComplete: Math.round((processedFiles / totalFiles) * 100)
      });
    }));
  }

  emitter.emit('complete', identicalFiles);
  return emitter;
}

module.exports = { findIdenticalFiles };
