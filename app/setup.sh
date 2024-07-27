APP=cloud-storage-file-browser

# setup static ip
gcloud compute addresses create $APP-address  --global

gcloud compute ssl-certificates create $APP-certificate --domains $APP.hypherdata.com

gcloud compute backend-buckets create $APP-backend --gcs-bucket-name=hd-$APP

gcloud compute url-maps create $APP-url-map --default-backend-bucket=$APP-backend

gcloud compute target-http-proxies create $APP-http-proxy --url-map=$APP-url-map

gcloud compute target-https-proxies create $APP-https-proxy  --url-map=$APP-url-map --ssl-certificates=$APP-certificate

gcloud compute forwarding-rules create $APP-rule-http --address=$APP-address --global --target-http-proxy=$APP-http-proxy --ports=80
gcloud compute forwarding-rules create $APP-rule-https --address=$APP-address --global --target-https-proxy=$APP-https-proxy  --ports=443
