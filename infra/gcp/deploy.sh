#!/usr/bin/env bash
# Deploy SweepTrack to Google Cloud Run + Cloud Scheduler.
# Prereqs: gcloud CLI logged in, a project with billing, and secrets created in Secret Manager:
#   DATABASE_URL, ENCRYPTION_KEY, INBOUND_WEBHOOK_SECRET, CRON_SECRET
#   (optional) ANTHROPIC_API_KEY, GOOGLE_CLIENT_SECRET, MICROSOFT_CLIENT_SECRET
# Usage: PROJECT=my-proj REGION=us-central1 APP_URL=https://app.example.com ./infra/gcp/deploy.sh
set -euo pipefail

: "${PROJECT:?set PROJECT}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-sweeptrack}"
: "${APP_URL:?set APP_URL (the public URL users visit)}"

gcloud config set project "$PROJECT" >/dev/null
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com

secret_flags="DATABASE_URL=DATABASE_URL:latest,ENCRYPTION_KEY=ENCRYPTION_KEY:latest"
secret_flags+=",INBOUND_WEBHOOK_SECRET=INBOUND_WEBHOOK_SECRET:latest,CRON_SECRET=CRON_SECRET:latest"
for optional in ANTHROPIC_API_KEY GOOGLE_CLIENT_SECRET MICROSOFT_CLIENT_SECRET; do
  if gcloud secrets describe "$optional" >/dev/null 2>&1; then secret_flags+=",$optional=$optional:latest"; fi
done

# Scale to zero; one small instance handles early traffic. Billing is per request-second.
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --cpu 1 --memory 512Mi \
  --min-instances 0 --max-instances 3 \
  --concurrency 40 \
  --timeout 300 \
  --set-env-vars "APP_URL=${APP_URL},INBOUND_EMAIL_DOMAIN=${INBOUND_EMAIL_DOMAIN:-in.example.com},ADMIN_EMAILS=${ADMIN_EMAILS:-},GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-},MICROSOFT_CLIENT_ID=${MICROSOFT_CLIENT_ID:-},MAIL_SERVICE_ENABLED=${MAIL_SERVICE_ENABLED:-false}" \
  --set-secrets "$secret_flags"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"
CRON_SECRET="$(gcloud secrets versions access latest --secret CRON_SECRET)"

# Background work every 15 minutes (Cloud Scheduler: first 3 jobs per account are free).
if gcloud scheduler jobs describe sweeptrack-tick --location "$REGION" >/dev/null 2>&1; then
  verb=update
else
  verb=create
fi
gcloud scheduler jobs "$verb" http sweeptrack-tick \
  --location "$REGION" \
  --schedule "*/15 * * * *" \
  --uri "${URL}/api/cron/tick" \
  --http-method POST \
  --headers "Authorization=Bearer ${CRON_SECRET}" \
  --attempt-deadline 320s

echo "Deployed: $URL"
echo "Run migrations from your machine: DATABASE_URL=<neon url> pnpm db:migrate && pnpm ingest seed-sources"
