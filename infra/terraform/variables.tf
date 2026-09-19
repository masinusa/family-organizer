variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run, Artifact Registry, and state"
  type        = string
  default     = "us-central1"
}

variable "service_name" {
  description = "Cloud Run service name"
  type        = string
  default     = "family-hub"
}

variable "ar_repo_name" {
  description = "Artifact Registry repository name"
  type        = string
  default     = "family-hub"
}

variable "github_repo" {
  description = "GitHub repo allowed to assume the deployer SA via WIF, as owner/repo"
  type        = string
  default     = "masinusa/family-organizer"
}

variable "iap_access_group" {
  description = "Google Group email authorized to pass IAP. Create this group and add family members before applying."
  type        = string
}

variable "billing_account_id" {
  description = "Cloud Billing account ID for the budget alert, format XXXXXX-XXXXXX-XXXXXX"
  type        = string
}

variable "budget_amount_usd" {
  description = "Monthly budget alert threshold amount"
  type        = number
  default     = 5
}

variable "budget_currency_code" {
  description = "Currency code for the budget amount"
  type        = string
  default     = "USD"
}

variable "placeholder_image" {
  description = "Image Cloud Run starts on before CI has ever pushed a real one. Terraform ignores changes to this field after the initial apply."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}
