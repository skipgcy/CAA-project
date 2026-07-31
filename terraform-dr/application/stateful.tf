data "aws_route53_zone" "primary" {
  provider     = aws.us_east_1
  name         = var.hosted_zone_name
  private_zone = false
}

data "aws_dynamodb_table" "ecommerce" {
  name = var.restored_table_name
}

resource "aws_s3_bucket" "website" {
  bucket        = var.dr_website_bucket_name
  force_destroy = true
}

resource "aws_s3_bucket_versioning" "website" {
  bucket = aws_s3_bucket.website.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_public_access_block" "website" {
  bucket                  = aws_s3_bucket.website.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "idempotency" {
  name         = var.idempotency_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  attribute {
    name = "PK"
    type = "S"
  }
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
  point_in_time_recovery { enabled = true }
}

resource "aws_sns_topic" "orders" { name = "bmazon-dr-order-notification" }

resource "aws_secretsmanager_secret" "stripe" {
  name                    = "bmazon-dr/stripe"
  description             = "Temporary DR copy of Stripe test credentials"
  recovery_window_in_days = 0
}

resource "aws_sesv2_email_identity" "sender" {
  email_identity = var.ses_from_email
}

resource "aws_cognito_user_pool" "customers" {
  name                     = "bmazon-dr-customers"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  password_policy {
    minimum_length                   = 10
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }
  deletion_protection = "INACTIVE"
}

resource "aws_cognito_user_pool_client" "web" {
  name                                 = "bmazon-dr-web-pkce"
  user_pool_id                         = aws_cognito_user_pool.customers.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "phone"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["${local.frontend_origin}/checkout.html", "${local.frontend_origin}/index.html"]
  logout_urls                          = ["${local.frontend_origin}/index.html"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_AUTH", "ALLOW_USER_SRP_AUTH"]
}

resource "aws_cognito_user_pool_domain" "customers" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.customers.id
}

resource "aws_cognito_managed_login_branding" "web" {
  user_pool_id                = aws_cognito_user_pool.customers.id
  client_id                   = aws_cognito_user_pool_client.web.id
  use_cognito_provided_values = true
}

resource "aws_cognito_user_group" "admins" {
  name         = "Admins"
  user_pool_id = aws_cognito_user_pool.customers.id
  description  = "Temporary Bmazon DR administrators"
  precedence   = 1
}
