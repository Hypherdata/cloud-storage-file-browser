gcloud builds submit --tag gcr.io/hypherdata-cloud-prod/image-similarity-service

gcloud run deploy image-similarity-service \
  --image gcr.io/hypherdata-cloud-prod/image-similarity-service \
  --platform managed \
  --region us-central1 \
  --cpu 2 \
  --memory 8Gi \
  --concurrency 80 \
  --timeout 3600 \
  --port 8080 \
  --allow-unauthenticated

#gcloud beta run services logs tail image-similarity-service --region us-central1
