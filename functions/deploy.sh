gcloud functions deploy cloud-storage-file-browser \
  --runtime nodejs20 \
  --trigger-http \
  --allow-unauthenticated \
  --memory 512MB \
  --timeout 120s \
  --env-vars-file .env.yaml \
  --region us-central1 \
  --gen2
