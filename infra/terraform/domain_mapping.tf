# Cloud Run Domain Mapping is in preview, not GA (Google flags it as not
# production-ready due to latency characteristics) — accepted here since
# this is a small, non-critical family app. See docs/adr/0002 addendum.
#
# custom_domain is the apex domain (spicers.family) — Cloud Run issues A and
# AAAA records for host @ rather than the CNAME it would give for a
# subdomain. Those records must be created at the registrar (Cloudflare) as
# "DNS only", not proxied, or Google's cert provisioning breaks.
resource "google_cloud_run_domain_mapping" "app" {
  location = var.region
  name     = var.custom_domain

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.app.name
  }

  depends_on = [google_cloud_run_v2_service.app]
}
