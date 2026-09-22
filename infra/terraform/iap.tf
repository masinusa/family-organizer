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

# Bootstrap/recovery path: guarantees at least one real way in that's
# independent of the app's own dynamic IAM management below — mirrors the
# Firestore-side safety net (scripts/seed-admin.ts). The app manages
# everyone else's access directly (see lib/iap-access.ts); Terraform owns
# only this one binding and should never be asked to own more, or `apply`
# would fight the app's own IAM writes.
resource "google_iap_web_cloud_run_service_iam_member" "bootstrap_admin" {
  project                = var.project_id
  location               = google_cloud_run_v2_service.app.location
  cloud_run_service_name = google_cloud_run_v2_service.app.name
  role                   = "roles/iap.httpsResourceAccessor"
  member                 = "user:${var.bootstrap_admin_email}"
}

# Custom role scoped to exactly the get/setIamPolicy permissions on IAP web
# resources — narrower than the predefined roles/iap.admin, which also
# bundles in TCP-tunnel IAM permissions this app never uses. This is what
# lets the runtime SA grant/revoke per-user IAP access itself, replacing a
# Google Group (which can't be managed by API without a Workspace/Cloud
# Identity org — see docs/adr for why that was dropped).
resource "google_project_iam_custom_role" "iap_access_manager" {
  role_id     = "iapAccessManager"
  title       = "IAP Access Manager (family-hub)"
  description = "Get/set IAM policy on IAP web resources only, so the family-hub runtime SA can manage its own per-user IAP allow-list."
  permissions = [
    "iap.webServices.getIamPolicy",
    "iap.webServices.setIamPolicy",
    "iap.webServiceVersions.getIamPolicy",
    "iap.webServiceVersions.setIamPolicy",
  ]
}

resource "google_project_iam_member" "runtime_iap_access_manager" {
  project = var.project_id
  role    = google_project_iam_custom_role.iap_access_manager.id
  member  = "serviceAccount:${google_service_account.runtime.email}"
}
