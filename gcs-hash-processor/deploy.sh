docker build -t gcr.io/hypherdata-cloud-prod/gcs-hash-processor .

#gcloud services enable run.googleapis.com
#gcloud services enable cloudbuild.googleapis.com
#gcloud services enable storage.googleapis.com
#gcloud services enable firestore.googleapis.com

#gcloud auth configure-docker

docker push gcr.io/hypherdata-cloud-prod/gcs-hash-processor

gcloud run deploy gcs-hash-processor \
  --image gcr.io/hypherdata-cloud-prod/gcs-hash-processor \
  --platform managed \
  --region us-central1 \
  --memory 4Gi \
  --concurrency 80 \
  --timeout 3600 \
  --allow-unauthenticated

#gcloud pubsub topics create gcs-file-updates
#gsutil notification create -t gcs-file-updates -f json gs://bacteria-collection-data
#gcloud run services update gcs-hash-processor \
#  --set-env-vars PUBSUB_TOPIC=projects/hypherdata-cloud-prod/topics/gcs-file-updates \
#  --region us-central1
#gcloud run services add-iam-policy-binding gcs-hash-processor \
#  --member=serviceAccount:service-623119481046@gcp-sa-pubsub.iam.gserviceaccount.com \
#  --role=roles/run.invoker \
#  --region us-central1



#gcloud projects describe hypherdata-cloud-prod --format="value(projectNumber)"

#gcloud app logs read --service gcs-hash-processor

#CLOUD_RUN_URL=https://gcs-hash-processor-46efresdxq-uc.a.run.app
#BUCKET_NAME=hd-hypherdata-cloud-prod

#curl -X POST https://gcs-hash-processor-46efresdxq-uc.a.run.app/process-bucket \
#  -H "Content-Type: application/json" \
#  -d '{"bucket": "bacteria-collection-data"}'

#curl "[YOUR_CLOUD_RUN_URL]/find-identical-files?bucket=[BUCKET_NAME]"

