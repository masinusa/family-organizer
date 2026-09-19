resource "google_artifact_registry_repository" "app" {
  repository_id = var.ar_repo_name
  location      = var.region
  format        = "DOCKER"
  description   = "Container images for the family-hub app"

  depends_on = [google_project_service.apis]
}
