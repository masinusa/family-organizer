provider "google" {
  project = var.project_id
  region  = var.region

  # Needed when applying with user (gcloud) credentials rather than a
  # service account key: some APIs (e.g. billingbudgets.googleapis.com)
  # ignore the ADC quota_project_id and instead bill/quota-check against
  # gcloud's own default OAuth client project unless explicitly overridden
  # here. See docs/knowledge-base.md.
  user_project_override = true
  billing_project       = var.project_id
}
