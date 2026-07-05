variable "aws_region" {
  type    = string
  default = "us-east-1"
}
variable "environment" {
  type    = string
  default = "prod"
}
variable "domain_name" {
  type    = string
  default = "ezei.shop"
}
variable "website_bucket_name" {
  type    = string
  default = "chenyu-caa900-project"
}
variable "ecommerce_table_name" {
  type    = string
  default = "Ecommerce"
}
variable "idempotency_table_name" {
  type    = string
  default = "OrderIdempotency"
}
variable "stripe_secret_name" {
  type    = string
  default = "bmazon/stripe"
}
variable "ses_from_email" {
  type    = string
  default = "chenyugao.ca@gmail.com"
}
variable "cognito_domain_prefix" {
  type    = string
  default = "ezei-shop-auth"
}
variable "admin_username" {
  type     = string
  default  = null
  nullable = true
}
variable "github_repository" {
  type    = string
  default = "skipgcy/CAA-project"
}

variable "lambda_function_names" {
  description = "Use existing physical names during import; use clean unique names for a fresh deployment."
  type        = map(string)
  default = {
    products           = "bmazon-products"
    product            = "bmazon-product"
    orders             = "bmazon-orders"
    admin_orders       = "bmazon-admin-orders"
    payment            = "bmazon-payment"
    stripe_webhook     = "bmazon-stripe-webhook"
    notification       = "bmazon-notification"
    order_notification = "bmazon-order-notification"
  }
}
