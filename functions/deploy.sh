# set permissions for the service account on bucket
#gsutil iam ch serviceAccount:file-operator@hypherdata-cloud-prod.iam.gserviceaccount.com:roles/storage.objectViewer gs://bacteria-collection-data

# deploy to cloud functions via service account
gcloud functions deploy cloud-storage-file-browser-api \
  --runtime nodejs20 \
  --trigger-http \
  --allow-unauthenticated \
  --memory 512MB \
  --timeout 120s \
  --env-vars-file .env.yaml \
  --region us-central1 \
  --service-account file-operator@hypherdata-cloud-prod.iam.gserviceaccount.com \
  --gen2


