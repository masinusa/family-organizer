# Custom role scoped to exactly what the vault needs, rather than the
# predefined roles/secretmanager.admin — same reasoning as
# google_project_iam_custom_role.iap_access_manager in iap.tf: the runtime SA
# should be able to manage subscription passwords and nothing else about
# Secret Manager (no IAM changes, no listing other projects' secrets).
#
# Note this is project-scoped, so it does cover every secret in the project,
# including the mailbox app password below (which the app must read). The
# project holds nothing else, which is what makes that acceptable; if it ever
# does, split this into two bindings with an IAM condition on
# resource.name.startsWith(".../secrets/sub-").
resource "google_project_iam_custom_role" "subscription_secret_manager" {
  role_id     = "subscriptionSecretManager"
  title       = "Subscription Secret Manager (family-hub)"
  description = "Create/read/delete secrets and add versions, so the family-hub runtime SA can store and reveal subscription passwords."
  permissions = [
    "secretmanager.secrets.create",
    "secretmanager.secrets.get",
    "secretmanager.secrets.delete",
    "secretmanager.versions.add",
    "secretmanager.versions.access",
  ]
}

resource "google_project_iam_member" "runtime_subscription_secret_manager" {
  project = var.project_id
  role    = google_project_iam_custom_role.subscription_secret_manager.id
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# The container only. There is deliberately NO
# google_secret_manager_secret_version resource here: the app password would
# then live in Terraform state and in a tfvars file, which is exactly what
# this repo refuses to do (see the IAP OAuth client secret in
# docs/adr/0002-gcp-cloud-run-iap.md, kept in IAP's own settings and nowhere
# else). Add the value once, by hand:
#
#   printf '%s' '<app password>' | gcloud secrets versions add \
#     family-mailbox-app-password --project=<project-id> --data-file=-
#
# The app password is minted from the mailbox's own Google Account
# (myaccount.google.com -> Security -> App passwords), which requires 2-step
# verification to be on for it. app/src/lib/mailbox.ts reads this secret on
# every Recent-mail request and never caches it.
resource "google_secret_manager_secret" "mailbox_app_password" {
  secret_id = "family-mailbox-app-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}
