variable "aws_profile" { type = string }
variable "aws_account_id" {
  type = string
  validation {
    condition     = var.aws_account_id == "563960656220"
    error_message = "The approved AWS account is 563960656220."
  }
}
variable "primary_region" {
  type = string
  validation {
    condition     = var.primary_region == "us-east-1"
    error_message = "The approved production region is us-east-1."
  }
}
variable "dr_region" {
  type = string
  validation {
    condition     = var.dr_region == "us-east-2"
    error_message = "This configuration may only create application resources in us-east-2."
  }
}
variable "hosted_zone_name" {
  type = string
  validation {
    condition     = var.hosted_zone_name == "ezei.shop"
    error_message = "Only the existing ezei.shop hosted zone may be read."
  }
}
variable "dr_domain_name" {
  type = string
  validation {
    condition     = var.dr_domain_name == "dr.ezei.shop"
    error_message = "Only the approved isolated DR frontend domain may be managed."
  }
}
variable "dr_api_domain_name" {
  type = string
  validation {
    condition     = var.dr_api_domain_name == "api.dr.ezei.shop"
    error_message = "Only the approved isolated DR API domain may be managed."
  }
}
variable "dr_website_bucket_name" { type = string }
variable "restored_table_name" {
  type = string
  validation {
    condition     = var.restored_table_name == "Ecommerce-DR"
    error_message = "The application may only use the restored Ecommerce-DR table."
  }
}
variable "idempotency_table_name" { type = string }
variable "ses_from_email" { type = string }
variable "cognito_domain_prefix" { type = string }
variable "source_stripe_secret_id" { type = string }

# Accepted by the shared DR variable file but intentionally not used by application.
variable "production_table_name" { type = string }
variable "production_table_arn" { type = string }
variable "backup_retention_days" { type = number }
variable "dr_recovery_point_retention" { type = number }
