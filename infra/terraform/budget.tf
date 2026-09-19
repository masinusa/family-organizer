resource "google_billing_budget" "family_hub" {
  billing_account = var.billing_account_id
  display_name    = "family-hub monthly budget"

  budget_filter {
    projects = ["projects/${data.google_project.current.number}"]
  }

  amount {
    specified_amount {
      currency_code = var.budget_currency_code
      units         = tostring(var.budget_amount_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 0.9
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }

  # No all_updates_rule block: billing account admins get the default email
  # alerts at each threshold without needing a Pub/Sub topic or monitoring
  # notification channel configured.
}
