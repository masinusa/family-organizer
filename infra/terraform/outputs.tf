output "GCP_PROJECT_ID" {
  value = var.project_id
}

output "GCP_REGION" {
  value = var.region
}

output "GCP_SERVICE_NAME" {
  value = google_cloud_run_v2_service.app.name
}

output "AR_REPO" {
  value = google_artifact_registry_repository.app.repository_id
}

output "WIF_PROVIDER" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "DEPLOYER_SA" {
  value = google_service_account.deployer.email
}

# DNS records to create at the registrar (Cloudflare) to complete the
# domain mapping — A/AAAA for the apex host @. Don't hardcode these
# elsewhere since Google can change them.
output "DOMAIN_MAPPING_DNS_RECORDS" {
  value = google_cloud_run_domain_mapping.app.status[0].resource_records
}
