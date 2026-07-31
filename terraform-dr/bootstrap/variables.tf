variable "aws_profile" { type = string }
variable "aws_account_id" { type = string }
variable "primary_region" {
  type = string
  validation {
    condition     = var.primary_region == "us-east-1"
    error_message = "The approved production source region is us-east-1."
  }
}
variable "dr_region" {
  type = string
  validation {
    condition     = var.dr_region == "us-east-2"
    error_message = "This temporary DR configuration is restricted to us-east-2."
  }
}
variable "production_table_name" { type = string }
variable "production_table_arn" {
  type = string
  validation {
    condition     = var.production_table_arn == "arn:aws:dynamodb:us-east-1:563960656220:table/Ecommerce"
    error_message = "Only the approved production Ecommerce table may be selected for backup."
  }
}
variable "backup_retention_days" {
  type    = number
  default = 7
}
variable "dr_recovery_point_retention" {
  type    = number
  default = 7
}

# Accepted by the shared DR variable file but intentionally unused in bootstrap.
variable "hosted_zone_name" { type = string }
variable "dr_domain_name" { type = string }
variable "dr_api_domain_name" { type = string }
variable "dr_website_bucket_name" { type = string }
variable "restored_table_name" { type = string }
variable "idempotency_table_name" { type = string }
variable "ses_from_email" { type = string }
variable "cognito_domain_prefix" { type = string }
variable "source_stripe_secret_id" { type = string }
