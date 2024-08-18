SERVICE=gcs-ssim-comparison

gcloud builds submit --tag gcr.io/hypherdata-cloud-prod/$SERVICE
gcloud run deploy $SERVICE \
  --image gcr.io/hypherdata-cloud-prod/$SERVICE \
  --platform managed \
  --region us-central1 \
  --memory 4Gi \
  --concurrency 80 \
  --timeout 3600 \
  --allow-unauthenticated
