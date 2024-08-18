SERVICE=gcs-ssim-comparison

URI=$(gcloud run services describe $SERVICE --platform managed --region us-central1 --format 'value(status.url)')

echo "URI: $URI"

curl -X POST \
  "$URI"/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
     "bucket_name": "bacteria-collection-data-test",
     "similarity_threshold": 0.9,
     "report_filename": "similarity_report.json"
  }'
