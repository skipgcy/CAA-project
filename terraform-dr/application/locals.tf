locals {
  frontend_origin = "https://${var.dr_domain_name}"
  dr_tags = {
    Project     = "CAA900-Bmazon"
    Environment = "DR"
    Temporary   = "true"
    ManagedBy   = "Terraform-DR"
  }

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

  lambda_names = {
    for key, value in local.lambdas : key => "bmazon-dr-${replace(key, "_", "-")}"
  }
}
