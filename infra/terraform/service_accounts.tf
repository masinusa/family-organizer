resource "google_service_account" "deployer" {
  account_id   = "family-hub-deployer"
  display_name = "family-hub CI/CD deployer (impersonated via WIF)"

  depends_on = [google_project_service.apis]
}

resource "google_service_account" "runtime" {
  account_id   = "family-hub-runtime"
  display_name = "family-hub Cloud Run runtime identity"

  depends_on = [google_project_service.apis]
}

resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  repository = google_artifact_registry_repository.app.name
  location   = google_artifact_registry_repository.app.location
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

# gcloud run deploy / deploy-cloudrun requires some project-scoped list/get
# permissions beyond what a resource-level binding on one service can grant.
resource "google_project_iam_member" "deployer_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_act_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

# Custom service accounts don't inherit the default compute SA's implicit
# logging/monitoring write access, so grant it explicitly.
resource "google_project_iam_member" "runtime_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_metric_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}
