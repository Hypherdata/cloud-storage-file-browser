const { Storage } = require('@google-cloud/storage');
const { OAuth2Client } = require('google-auth-library');
const functions = require('@google-cloud/functions-framework');
const path = require('path');
const archiver = require('archiver');
const stream = require('stream');

console.log(process.env);

const DEFAULT_SETTINGS = {
  defaultPublicFiles: false,
  privateUrlExpiration: 7,
  cdnAdmins: '',
  cdnUploaders: '',
  cdnDownloaders: ''
};

const bucket = new Storage().bucket(process.env.CDN_BUCKET_NAME);
const CDN_URL = process.env.CDN_URL || null;
const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN || '*';
let CDN_ADMINS = [process.env.CDN_ADMIN];
let CDN_UPLOADERS = [process.env.CDN_UPLOADERS];
let CDN_DOWNLOADERS = [process.env.CDN_DOWNLOADERS];
let PRIVATE_URL_EXPIRY_DAYS = DEFAULT_SETTINGS.privateUrlExpiration;

async function getUserSettings() {
  if (!(await bucket.file('.bucket.dashboard-settings.json').exists())[0]) return DEFAULT_SETTINGS;
  return JSON.parse((await bucket.file('.bucket.dashboard-settings.json').download())[0].toString('utf8'));
}

async function updateWithUserSettings() {
  const userSettings = await getUserSettings();
  if (!userSettings.useSettings) return;
  PRIVATE_URL_EXPIRY_DAYS = userSettings.privateUrlExpiration;
  CDN_ADMINS = [process.env.CDN_ADMIN];
  CDN_ADMINS.push(...userSettings.cdnAdmins.split(','));
  CDN_UPLOADERS = [process.env.CDN_UPLOADERS];
  CDN_UPLOADERS.push(...userSettings.cdnUploaders.split(','));
  CDN_DOWNLOADERS = [process.env.CDN_DOWNLOADERS];
  CDN_DOWNLOADERS.push(...userSettings.cdnDownloaders.split(','));
  console.log(userSettings);
}

let CorsAlreadyChecked = false;
async function setBucketCors() {
  if (CorsAlreadyChecked) return;
  const corsSetFlag = bucket.file('.bucket.cors-configured');
  if ((await corsSetFlag.exists())[0]) { CorsAlreadyChecked = true; return; }
  const corsConfig = [{
    "method": ["*"],
    "origin": [DASHBOARD_ORIGIN],
    "responseHeader": ["*"]
  }];
  await bucket.setCorsConfiguration(corsConfig);
  await corsSetFlag.save(`This bucket's CORS has been set to allow request from the file manager`);
  CorsAlreadyChecked = true;
}

async function auth(req) {
  console.log("start auth");
  console.log(req.headers);
  const idToken = req.headers.authorization && req.headers.authorization.split('Bearer ')[1];

  if (!idToken) throw new Error("no id token");

  try {
    const oauthClient = new OAuth2Client(process.env.OAUTH_CLIENT_ID);
    const payload = (await oauthClient.verifyIdToken({
      idToken: idToken,
      audience: process.env.OAUTH_CLIENT_ID
    })).getPayload()

    console.log(payload);

    const userEmail = payload.email;

    console.log("userEmail:", userEmail);
    console.log("CDN_ADMINS:", CDN_ADMINS);
    console.log("CDN_ADMINS.includes(userEmail):", CDN_ADMINS.includes(userEmail));
    console.log("CDN_UPLOADERS:", CDN_UPLOADERS);
    console.log("CDN_UPLOADERS.includes(userEmail):", CDN_UPLOADERS.includes(userEmail));
    console.log("CDN_DOWNLOADERS:", CDN_DOWNLOADERS);
    console.log("CDN_DOWNLOADERS.includes(userEmail):", CDN_DOWNLOADERS.includes(userEmail));

    console.log("!CDN_ADMINS.includes(userEmail)",!CDN_ADMINS.includes(userEmail))
    console.log("!CDN_UPLOADERS.includes(userEmail)",!CDN_UPLOADERS.includes(userEmail))
    console.log("!CDN_DOWNLOADERS.includes(userEmail)",!CDN_DOWNLOADERS.includes(userEmail));

    if (!CDN_ADMINS.includes(userEmail) && !CDN_UPLOADERS.includes(userEmail) && !CDN_DOWNLOADERS.includes(userEmail)) throw new Error("Unauthorized not included in CDN_ADMINS or CDN_DOWNLOADERS or CDN_DOWNLOADERS");

    console.log("end auth");

    return userEmail;
  } catch (err) {
    console.error(err);
    throw new Error("Unauthorized");
  }
}

// Updated helper function to list files and directories with pagination
async function listFilesAndDirs(prefix, pageToken = null, pageSize = 100) {
  if (prefix && !prefix.endsWith('/')) {
    prefix += '/';
  }
  prefix = prefix.replace(/[,/]+/g, '/');

  console.log("listFilesAndDirs with prefix: ", prefix);

  const options = {
    prefix: prefix,
    delimiter: '/',
    autoPaginate: false,
    maxResults: pageSize,
  };

  if (pageToken && pageToken !== 'null') {
    options.pageToken = pageToken;
  }

  // Get files
  const [filesResponse] = await bucket.getFiles(options);
  console.log("Files response:", filesResponse);
  console.log("filesResponse length:", filesResponse?.length);

  let fileList = [];
  if (Array.isArray(filesResponse)) {
    console.log("files length:", filesResponse.length);
    fileList = filesResponse
        .filter(file => file && file.name !== prefix)  // Exclude the directory itself
        .map(file => {
          if (!file || !file.metadata) {
            console.warn("Unexpected file object:", file);
            return null;
          }
          const metadata = file.metadata;
          return {
            name: metadata.name,
            cacheControl: metadata.cacheControl || '',
            contentEncoding: metadata.contentEncoding || '',
            contentType: metadata.contentType || '',
            version: metadata.generation,
            id: metadata.id,
            downloadLink: metadata.mediaLink,
            path: metadata.name,
            size: metadata.size,
            updated: metadata.updated,
            type: 'file',
            bucket: file.bucket.name,
          };
        })
        .filter(file => file !== null);
    } else {
      console.warn("Unexpected files response structure:", filesResponse);
    }

  // Get directories (prefixes)
  const [, , prefixesResponse] = await bucket.getFiles(options);
  console.log("prefixesResponse:", prefixesResponse);

  let dirList = [];
  if (prefixesResponse && Array.isArray(prefixesResponse.prefixes)) {
    dirList = prefixesResponse.prefixes.map(dir => ({
      name: dir,
      path: dir,
      type: 'directory'
    }));
  } else {
    console.warn("Unexpected prefixes response structure:", prefixesResponse);
  }

  return {
    items: [...dirList, ...fileList],
    nextPageToken: prefixesResponse.nextPageToken
  };
}

async function downloadFolder(folderPath) {
  console.log("downloadFolder with folderPath: ", folderPath);
  const [files] = await bucket.getFiles({ prefix: folderPath });

  console.log("files:", files);
  const archive = archiver('zip', {
    zlib: { level: 9 } // Sets the compression level.
  });

  const passThrough = new stream.PassThrough();

  archive.pipe(passThrough);

  for (const file of files) {
    console.log("file:", file);
    const filename = file.name.slice(folderPath.length);
    const fileStream = file.createReadStream();
    archive.append(fileStream, { name: filename });
  }

  console.log("finalizing archive");
  await archive.finalize();

  console.log("returning passThrough");
  return passThrough;
}

async function renameFolder(oldFolderName, newFolderName) {
  if (!oldFolderName.endsWith('/')) oldFolderName += '/';
  if (!newFolderName.endsWith('/')) newFolderName += '/';

  const [files] = await bucket.getFiles({ prefix: oldFolderName });

  const movePromises = files.map(file => {
    const newName = file.name.replace(oldFolderName, newFolderName);
    return file.move(newName);
  });

  try {
    await Promise.all(movePromises);
    console.log(`Successfully renamed folder from ${oldFolderName} to ${newFolderName}`);
    return true;
  } catch (error) {
    console.error('Error renaming folder:', error);
    return false;
  }
}

functions.http('cloud-storage-file-browser-api', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  let userEmail;
  try {
    userEmail = await auth(req);
  } catch (error) {
    console.error("error", error);
    return res.status(403).send(error.message);
  }

  const path = req.path;
  const method = req.method;

  console.log("path:", path);
  console.log("method:", method);
  console.log("req.query:", req.query);
  console.log("req.body:", req.body);
  console.log("req.headers:", req.headers);
  console.log("req.method:", req.method);
  console.log("req.url:", req.url);

  try {
    switch (`${method} ${path}`) {
      case 'GET /get-files':
        const currentPath = req.query.path || '';
        const pageToken = req.query.pageToken || null;
        const pageSize = parseInt(req.query.pageSize) || 100;
        const { items, nextPageToken } = await listFilesAndDirs(currentPath, pageToken, pageSize);
        return res.json({
          bucket: process.env.CDN_BUCKET_NAME,
          currentPath: currentPath,
          files: items,
          nextPageToken: nextPageToken
        });
      case 'GET /download-folder':
        const folderPath = req.query.path;
        if (!folderPath) {
          return res.status(400).send('Folder path is required');
        }

        const downloadStream = await downloadFolder(folderPath);

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${folderPath.split('/').pop()}.zip"`);

        downloadStream.pipe(res);
        return res;

      case 'POST /rename-folder':
        const { oldFolderName, newFolderName } = req.body;

        if (!oldFolderName || !newFolderName) {
          return res.status(400).json({ error: 'Both oldFolderName and newFolderName are required' });
        }

        const success = await renameFolder(oldFolderName, newFolderName);

        if (success) {
          res.status(200).json({ message: 'Folder renamed successfully' });
        } else {
          res.status(500).json({ error: 'Failed to rename folder' });
        }

      // case 'POST /set-public':
      //   await bucket.file(req.body.filepath).makePublic();
      //   return res.json({ success: true });

      // case 'POST /set-private':
      //   await bucket.file(req.body.filepath).makePrivate();
      //   return res.json({ success: true });

      case 'POST /get-share-url':
        const expiryDate = new Date(Date.now() + 60 * 60 * 1000);
        if (!req.body.download) expiryDate.setDate(expiryDate.getDate() + PRIVATE_URL_EXPIRY_DAYS);
        const [url] = await bucket.file(req.body.filepath).getSignedUrl({
          version: 'v2',
          action: 'read',
          expires: expiryDate,
          cname: req.body.download ? null : CDN_URL,
          promptSaveAs: req.body.download ? req.body.filepath.split('/').pop() : null
        });
        return res.json({ url, duration: PRIVATE_URL_EXPIRY_DAYS });

      case 'POST /get-new-upload-policy':
        await setBucketCors();
        const newFile = bucket.file(req.body.filepath);
        const expDate = Date.now() + 60 * 60 * 1000;
        const options = {
          expires: expDate,
          conditions: [
            ['eq', '$Content-Type', req.body.fileContentType],
            ['content-length-range', 0, req.body.fileSize + 1024],
          ],
          fields: {
            'success_action_status': '201',
            'Content-Type': req.body.fileContentType
          }
        };
        const [response] = await newFile.generateSignedPostPolicyV4(options);
        return res.json({ url: response.url, fields: response.fields });

      case 'POST /add-folder':
        const newFolder = bucket.file(req.body.folderpath + '/');
        const [exists] = await newFolder.exists();
        if (exists) return res.status(409).json({ error: 'file-exists' });
        await newFolder.save('');
        return res.json({ saved: true });

      case 'POST /delete-file':
        if (!CDN_ADMINS.includes(userEmail)) return res.status(403).json({ error: 'unauthorized' });
        await bucket.file(req.body.filepath).delete();
        return res.json({ deleted: true });

      case 'POST /move-file':
        if (!CDN_ADMINS.includes(userEmail)) return res.status(403).json({ error: 'unauthorized' });
        if ((await bucket.file(req.body.destination).exists())[0]) return res.status(409).json({ alreadyExists: true, success: false });
        const [wasPublic] = await bucket.file(req.body.filepath).isPublic();
        await bucket.file(req.body.filepath).move(req.body.destination);
        if (wasPublic) await bucket.file(req.body.destination).makePublic();
        else await bucket.file(req.body.destination).makePrivate();
        return res.json({ success: true });

      case 'GET /get-settings':
        return res.json({ settings: await getUserSettings() });

      case 'POST /save-settings':
        if (!CDN_ADMINS.includes(userEmail)) return res.status(403).json({ error: 'unauthorized' });
        await bucket.file('.bucket.dashboard-settings.json').save(JSON.stringify(req.body.settings));
        await updateWithUserSettings();
        return res.json({ success: true });

      default:
        return res.status(404).send('Route not found');
    }
  } catch (err) {
    console.error(new Error(err));
    return res.status(500).send('API Error');
  }
});

// Initialize settings
updateWithUserSettings();
