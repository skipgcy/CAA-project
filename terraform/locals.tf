locals {
  frontend_origin = "https://${var.domain_name}"
  api_domain      = "api.${var.domain_name}"

  lambdas = {
    products           = { handler = "functions/product/index.handler", timeout = 10 }
    product            = { handler = "functions/get-product/index.handler", timeout = 10 }
    orders             = { handler = "functions/order/index.handler", timeout = 10 }
    admin_orders       = { handler = "functions/admin-orders/index.handler", timeout = 10 }
    admin_products     = { handler = "functions/admin-products/index.handler", timeout = 10 }
    payment            = { handler = "functions/payment/index.handler", timeout = 10 }
    stripe_webhook     = { handler = "functions/stripe-webhook/index.handler", timeout = 10 }
    notification       = { handler = "functions/notification/index.handler", timeout = 10 }
    order_notification = { handler = "functions/order-notification/index.handler", timeout = 30 }
  }

  routes = {
    "GET /products"                   = { function = "products", auth = false }
    "GET /products/{id}"              = { function = "product", auth = false }
    "POST /orders"                    = { function = "orders", auth = true }
    "GET /orders"                     = { function = "orders", auth = true }
    "GET /orders/{id}"                = { function = "orders", auth = true }
    "GET /admin/orders"               = { function = "admin_orders", auth = true }
    "PATCH /admin/orders/{id}"        = { function = "admin_orders", auth = true }
    "GET /admin/products"             = { function = "admin_products", auth = true }
    "POST /admin/products"            = { function = "admin_products", auth = true }
    "POST /admin/products/images"     = { function = "admin_products", auth = true }
    "PATCH /admin/products/{id}"      = { function = "admin_products", auth = true }
    "DELETE /admin/products/{id}"     = { function = "admin_products", auth = true }
    "POST /payment"                   = { function = "payment", auth = true }
    "POST /stripe/webhook"            = { function = "stripe_webhook", auth = false }
    "POST /orders/{id}/notifications" = { function = "notification", auth = true }
  }

  lambda_permissions = {
    products = [{ Effect = "Allow", Action = ["dynamodb:Scan"], Resource = aws_dynamodb_table.ecommerce.arn }]
    product  = [{ Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = aws_dynamodb_table.ecommerce.arn }]
    orders = [
      { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:TransactWriteItems", "dynamodb:UpdateItem", "dynamodb:PutItem"], Resource = [aws_dynamodb_table.ecommerce.arn, aws_dynamodb_table.idempotency.arn] },
      { Effect = "Allow", Action = ["sns:Publish"], Resource = aws_sns_topic.orders.arn }
    ]
    admin_orders = [
      { Effect = "Allow", Action = ["dynamodb:Query", "dynamodb:UpdateItem"], Resource = aws_dynamodb_table.ecommerce.arn },
      { Effect = "Allow", Action = ["sns:Publish"], Resource = aws_sns_topic.orders.arn }
    ]
    admin_products = [
      { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:Scan", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"], Resource = aws_dynamodb_table.ecommerce.arn },
      { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.website.arn}/assets/img/products/*" }
    ]
    payment = [
      { Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = aws_dynamodb_table.ecommerce.arn },
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.stripe.arn }
    ]
    stripe_webhook = [
      { Effect = "Allow", Action = ["dynamodb:UpdateItem"], Resource = aws_dynamodb_table.ecommerce.arn },
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.stripe.arn },
      { Effect = "Allow", Action = ["sns:Publish"], Resource = aws_sns_topic.orders.arn }
    ]
    notification = [
      { Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = aws_dynamodb_table.ecommerce.arn },
      { Effect = "Allow", Action = ["sns:Publish"], Resource = aws_sns_topic.orders.arn }
    ]
    order_notification = [
      { Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = aws_dynamodb_table.ecommerce.arn },
      { Effect = "Allow", Action = ["ses:SendEmail"], Resource = "*", Condition = { StringEquals = { "ses:FromAddress" = var.ses_from_email } } }
    ]
  }
}
