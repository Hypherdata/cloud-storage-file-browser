URI=$(gcloud run services describe image-similarity-service --platform managed --region us-central1 --format 'value(status.url)')

echo "URI: $URI"

curl -X POST \
  "$URI"/setup-product-set \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "bucketName": "bacteria-collection-data-png"
  }'
