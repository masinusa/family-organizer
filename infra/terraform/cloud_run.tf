resource "google_cloud_run_v2_service" "app" {
  name                = var.service_name
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"
  iap_enabled         = true

  template {
    service_account = google_service_account.runtime.email

    containers {
      image = var.placeholder_image
    }
  }

  # Terraform owns the service's shape; GitHub Actions owns which image is
  # deployed. Without this, every `terraform apply` would roll the service
  # back to the placeholder image, undoing CI's latest deploy.
  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }

  depends_on = [google_project_service.apis]
}

# Deliberately no google_cloud_run_v2_service_iam_member for allUsers here —
# that absence, combined with iap_enabled above, is what keeps the service
# private.
