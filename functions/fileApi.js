
const { Storage } = require('@google-cloud/storage');
const { OAuth2Client } = require('google-auth-library');
const functions= require('@google-cloud/functions-framework');

const oauthClient = new OAuth2Client(process.env.OAUTH_CLIENT_ID);

console.log(process.env);

functions.http('helloHttp', (req, res) => {
  res.send(`Hello ${req.query.name || req.body.name || 'World'}!`);
});


const DEFAULT_SETTINGS = {
  defaultPublicFiles: false,
  privateUrlExpiration: 7,
  cdnAdmins: ''
};

const bucket = new Storage().bucket(process.env.CDN_BUCKET_NAME);
const CDN_URL = process.env.CDN_URL || null;
const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN || '*';

let CDN_ADMINS = [process.env.CDN_ADMIN];
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
  const idToken = req.headers.authorization && req.headers.authorization.split('Bearer ')[1];

  if (!idToken) throw new Error("no id token");

  try {
    const userEmail = (await oauthClient.verifyIdToken({
      idToken: idToken,
      audience: process.env.OAUTH_CLIENT_ID
    })).getPayload().email;

    if (!CDN_ADMINS.includes(userEmail)) throw new Error("Unauthorized");

    return true;
  } catch (err) {
    console.error(err);
    throw new Error("Unauthorized");
  }
}

functions.http('fileApi', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  try {
    await auth(req);
  } catch (error) {
    return res.status(403).send(error.message);
  }

  const path = req.path;
  const method = req.method;

  try {
    switch (`${method} ${path}`) {
      case 'GET /get-files':
        const [files] = await bucket.getFiles();
        const filesResponse = files.map(({ metadata: file }) => ({
          cacheControl: file.cacheControl || '',
          contentEncoding: file.contentEncoding || '',
          contentType: file.contentType || '',
          version: file.generation,
          id: file.id,
          downloadLink: file.mediaLink,
          path: file.name,
          size: file.size,
          updated: file.updated,
        }));
        return res.json({ bucket: bucket.name, files: filesResponse });

      case 'POST /set-public':
        await bucket.file(req.body.filepath).makePublic();
        return res.json({ success: true });

      case 'POST /set-private':
        await bucket.file(req.body.filepath).makePrivate();
        return res.json({ success: true });

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
        await bucket.file(req.body.filepath).delete();
        return res.json({ deleted: true });

      case 'POST /move-file':
        if ((await bucket.file(req.body.destination).exists())[0]) return res.status(409).json({ alreadyExists: true, success: false });
        const [wasPublic] = await bucket.file(req.body.filepath).isPublic();
        await bucket.file(req.body.filepath).move(req.body.destination);
        if (wasPublic) await bucket.file(req.body.destination).makePublic();
        else await bucket.file(req.body.destination).makePrivate();
        return res.json({ success: true });

      case 'GET /get-settings':
        return res.json({ settings: await getUserSettings() });

      case 'POST /save-settings':
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
