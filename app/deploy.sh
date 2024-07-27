yarn build

# create bucket
# gsutil mb -p hypherdata-cloud-prod gs://hd-cloud-storage-file-browser

# Enable versioning
#gsutil versioning set on gs://hd-cloud-storage-file-browser

# deploy to bucket
#gsutil -m rsync -r build gs://hd-cloud-storage-file-browser # not works because of cache
gsutil -m cp -r build gs://hd-cloud-storage-file-browser

# set public access
#gsutil iam ch allUsers:objectViewer gs://hd-cloud-storage-file-browser

# set index.html as default page
#gsutil web set -m index.html -e index.html gs://hd-cloud-storage-file-browser

#Enable Cloud CDN (optional but recommended):
#You can set up Cloud CDN for better performance.

# cors
#gsutil cors set cors-config.json gs://hd-cloud-storage-file-browser

# URL
#https://storage.googleapis.com/hd-cloud-storage-file-browser/index.html

