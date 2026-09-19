# NOTE: there is deliberately no google_iap_brand/google_iap_client resource
# here. The IAP OAuth Admin API those resources depended on was fully shut
# down March 19, 2026 — they can no longer create anything. The OAuth
# consent screen must instead be configured once, manually, via Cloud
# Console (External audience, auto-generated credentials) before IAP will
# actually let anyone through — see the README quick start and
# docs/adr/0002-gcp-cloud-run-iap.md. `iap_enabled = true` on the Cloud Run
# service below will still apply cleanly without it; it just won't be
# reachable by anyone until that one-time manual step is done.

# Lets IAP itself call through to the otherwise-locked-down Cloud Run service.
resource "google_cloud_run_v2_service_iam_member" "iap_invoker" {
  name     = google_cloud_run_v2_service.app.name
  location = google_cloud_run_v2_service.app.location
  project  = var.project_id
  role     = "roles/run.invoker"
  member   = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-iap.iam.gserviceaccount.com"
}

# The actual family-access gate: who can get past IAP's login prompt.
# iap_access_group is a variable so the placeholder group can be swapped for
# a real one without touching any other resource.
resource "google_iap_web_cloud_run_service_iam_member" "family_access" {
  project                = var.project_id
  location               = google_cloud_run_v2_service.app.location
  cloud_run_service_name = google_cloud_run_v2_service.app.name
  role                   = "roles/iap.httpsResourceAccessor"
  member                 = "group:${var.iap_access_group}"
}
