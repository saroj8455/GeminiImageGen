# Deploy as a Cloud Run function

This project exposes one HTTP function named `menuApi` with these routes:

- `POST /api/generate-image`
- `POST /api/upload-image`
- `GET /health`

## Configuration

Cloud Run requires these environment variables:

- `GCP_PROJECT_ID`: Google Cloud project ID
- `GCS_BUCKET_NAME`: bucket used for generated and uploaded images
- `MONGODB_URI`: MongoDB Atlas connection string
- `GEMINI_API_KEY`: Gemini API key

Create the local configuration file from the included template:

```bash
cp cloud-run-env.example.yaml cloud-run-env.yaml
```

Replace every placeholder in `cloud-run-env.yaml`. The real file is excluded
from Git, Cloud Run source uploads, and `cloud-run-menu-api.zip`.

MongoDB Atlas must allow connections from Cloud Run. For production, use a VPC
and static egress IP, then add that IP to the Atlas access list.

## Google Cloud setup

Select the project and enable the required services:

```bash
gcloud config set project project-b084f18e-b822-4878-8b6

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com
```

Create a runtime service account. This command is only needed once:

```bash
gcloud iam service-accounts create menu-api-runtime \
  --display-name="Menu API Cloud Run runtime"
```

Allow it to create and clean up objects in the image bucket:

```bash
gcloud storage buckets add-iam-policy-binding gs://global-restro \
  --member="serviceAccount:menu-api-runtime@project-b084f18e-b822-4878-8b6.iam.gserviceaccount.com" \
  --role="roles/storage.objectUser"
```

The image bucket must also allow public object viewing if the returned
`storage.googleapis.com` URLs need to work without authentication.

## Option A: Deploy the ZIP

Cloud Run cannot deploy a local ZIP from a `gs://` URL until the ZIP has first
been uploaded to that exact Cloud Storage location. Use a private source bucket
instead of the public image bucket.

Create the private source bucket once. Bucket names are globally unique, so add
a suffix if this name is already taken:

```bash
gcloud storage buckets create \
  gs://project-b084f18e-b822-4878-8b6-cloud-run-source \
  --project=project-b084f18e-b822-4878-8b6 \
  --location=asia-south1 \
  --uniform-bucket-level-access
```

Upload the local deployment archive:

```bash
gcloud storage cp \
  cloud-run-menu-api.zip \
  gs://project-b084f18e-b822-4878-8b6-cloud-run-source/cloud-run-menu-api.zip
```

Verify the object exists before deploying:

```bash
gcloud storage ls \
  gs://project-b084f18e-b822-4878-8b6-cloud-run-source/cloud-run-menu-api.zip
```

Deploy the function:

```bash
gcloud run deploy menu-api \
  --source gs://project-b084f18e-b822-4878-8b6-cloud-run-source/cloud-run-menu-api.zip \
  --function menuApi \
  --base-image nodejs22 \
  --region asia-south1 \
  --allow-unauthenticated \
  --service-account menu-api-runtime@project-b084f18e-b822-4878-8b6.iam.gserviceaccount.com \
  --memory 1Gi \
  --timeout 300 \
  --env-vars-file cloud-run-env.yaml
```

## Option B: Deploy the current directory

This option uploads the source automatically and does not use the ZIP:

```bash
gcloud run deploy menu-api \
  --source . \
  --function menuApi \
  --base-image nodejs22 \
  --region asia-south1 \
  --allow-unauthenticated \
  --service-account menu-api-runtime@project-b084f18e-b822-4878-8b6.iam.gserviceaccount.com \
  --memory 1Gi \
  --timeout 300 \
  --env-vars-file cloud-run-env.yaml
```

## Fix `No such object`

This error means the object named in `--source` does not exist at that exact
bucket path for the active account:

```text
HTTPError 404: No such object: BUCKET/OBJECT
```

Check each item in order:

```bash
gcloud auth list
gcloud config get-value project
gcloud storage buckets describe gs://project-b084f18e-b822-4878-8b6-cloud-run-source
gcloud storage ls gs://project-b084f18e-b822-4878-8b6-cloud-run-source/
```

If the ZIP is absent, run the `gcloud storage cp` command again. The value after
`--source` must exactly match the path printed by `gcloud storage ls`.

## Test the deployment

Use the service URL printed by the deployment command:

```bash
curl "SERVICE_URL/health"

curl -X POST "SERVICE_URL/api/generate-image" \
  -H "Content-Type: application/json" \
  -d '{"menuName":"Classic Margherita Pizza"}'

curl -X POST "SERVICE_URL/api/upload-image" \
  -F "menuName=Maha Prasad Puri" \
  -F "menuItemImage=@/path/to/image.jpg"
```
