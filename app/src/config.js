// Duplicate and remove the underscore from this file and add your google oauth ID and API endpoint below before building

export default {
  googleClientId: '623119481046-r9urmc77ljm34f3ovj2576j4nlbp86at.apps.googleusercontent.com', // The OAUTH client ID for your file browser
  APIEndpoint: process.env.NODE_ENV === 'production' ? 'https://us-central1-hypherdata-cloud-prod.cloudfunctions.net/cloud-storage-file-browser-api' : "http://localhost:8080/cloud-storage-file-browser-api", // The URL to the cloud function
  CDN_URL: 'https://cloud-storage-file-browser.hypherdata.com', // The base URL to your CDN or bucket. This might be a custom subdomain or https://bucket-name.storage.googleapis.com/ if you don't have a CDN.
  BucketUrl: 'https://storage.googleapis.com/hd-cloud-storage-file-browser', // This is used to bypass the cache on your CDN. ONLY replace the YOUR-BUCKET-NAME part with the name of your bucket.
  appName: 'Hypherdata.com - File Exchange', // The name that appears at the top of the app menu.
  configVersion: 'v1.0.3' // The version of the config file. This is used to determine if the user's settings need to be updated."
}
