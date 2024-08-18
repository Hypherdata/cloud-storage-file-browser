gcloud services enable vision.googleapis.com

gcloud projects add-iam-policy-binding hypherdata-cloud-prod \
  --member="serviceAccount:your-service-account@your-project-id.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"

# Function to generate a unique product set ID
#prefix=${1:-imgset}
#date_str=$(date +%Y%m%d)
#random_str=$(head /dev/urandom | tr -dc 'a-z0-9' | fold -w 8 | head -n 1)
#PRODUCT_SET_ID=${prefix}_${date_str}_${random_str}
#echo "Generated Product Set ID: $PRODUCT_SET_ID"

gcloud beta ml vision product-search product-sets create \
  productset-bacteria-collection-data \
  --location=us-west1 \
  --display-name="Product Set for bacteria-collection-data"

gcloud beta ml vision product-search product-sets list \
  --project=hypherdata-cloud-prod \
  --location=us-west1

gcloud beta ml vision product-search products create \
    product-bacteria-collection-data \
    --project=hypherdata-cloud-prod \
    --location=us-west1 \
    --display-name="Product for bacteria-collection-data" \
    --category="apparel"

gcloud beta ml vision product-search products list \
  --project=hypherdata-cloud-prod \
  --location=us-west1

gcloud vision product-sets add-product productset-bacteria-collection-data \
  --project=hypherdata-cloud-prod \
  --location=us-west1 \
  --product=[PRODUCT_ID]

gcloud beta ml vision product-search images list \
  --product=product-bacteria-collection-data \
  --project=hypherdata-cloud-prod \
  --location=us-west1
