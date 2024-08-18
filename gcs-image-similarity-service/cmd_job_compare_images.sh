#gcloud run services update image-similarity-service \
#  --set-env-vars=PROJECT_ID=hypherdata-cloud-prod,LOCATION=us-west1,PRODUCT_SET_ID=imgset-bacteria-collection-data,RESULTS_BUCKET=[YOUR_RESULTS_BUCKET],TEMP_BUCKET=[YOUR_TEMP_BUCKET]

URI=$(gcloud run services describe image-similarity-service --platform managed --region us-central1 --format 'value(status.url)')

echo "URI: $URI"

curl -X POST \
  "$URI"/list-and-compare-images-job \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "bucketName": "bacteria-collection-data-png",
    "similarityThreshold": 0.5
  }'
