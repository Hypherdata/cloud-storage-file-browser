const { Storage } = require('@google-cloud/storage');
const { OAuth2Client } = require('google-auth-library');
const functions = require('@google-cloud/functions-framework');
const path = require('path');

console.log(process.env);

const DEFAULT_SETTINGS = {
  defaultPublicFiles: false,
  privateUrlExpiration: 7,
  cdnAdmins: ''
};

const bucket = new Storage().bucket(process.env.CDN_BUCKET_NAME);
const CDN_URL = process.env.CDN_URL || null;
const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN || '*';
let CDN_ADMINS = [process.env.CDN_ADMIN];
let CDN_USERS = [process.env.CDN_USERS];
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
    console.log("CDN_USERS:", CDN_USERS);
    console.log("CDN_ADMINS.includes(userEmail):", CDN_ADMINS.includes(userEmail));
    console.log("CDN_USERS.includes(userEmail):", CDN_USERS.includes(userEmail));

    if (!CDN_ADMINS.includes(userEmail) && !CDN_USERS.includes(userEmail)) throw new Error("Unauthorized not included in CDN_ADMINS or CDN_USERS");


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
        if (!CDN_ADMINS.includes(userEmail)) return res.status(403).json({ error: 'unauthorized' });
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
        if (!CDN_ADMINS.includes(userEmail)) return res.status(403).json({ error: 'unauthorized' });
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
