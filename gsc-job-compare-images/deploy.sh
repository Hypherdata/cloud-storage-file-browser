PROJECT=hypherdata-cloud-prod
IMAGE=job-compare-images
#docker build -t gcr.io/$PROJECT/$IMAGE:latest .
#docker push gcr.io/$PROJECT/$IMAGE:latest
gcloud builds submit --tag gcr.io/$PROJECT/$IMAGE
