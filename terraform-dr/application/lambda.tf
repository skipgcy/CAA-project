data "archive_file" "backend" {
  type        = "zip"
  source_dir  = "${path.module}/../../backend"
  output_path = "${path.module}/backend.zip"
  excludes    = ["node_modules", ".npmrc"]
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  for_each           = local.lambdas
  name               = "bmazon-dr-${replace(each.key, "_", "-")}-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.lambdas
  name              = "/aws/lambda/${local.lambda_names[each.key]}"
  retention_in_days = 7
}

locals {
  lambda_permissions = {
    products = [{ Effect = "Allow", Action = ["dynamodb:Scan"], Resource = data.aws_dynamodb_table.ecommerce.arn }]
    product  = [{ Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = data.aws_dynamodb_table.ecommerce.arn }]
    orders = [
      { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:TransactWriteItems", "dynamodb:UpdateItem", "dynamodb:PutItem"], Resource = [data.aws_dynamodb_table.ecommerce.arn, aws_dynamodb_table.idempotency.arn] },
      { Effect = "Allow", Action = ["sns:Publish"], Resource = aws_sns_topic.orders.arn }
    ]
    admin_orders = [
      { Effect = "Allow", Action = ["dynamodb:Query", "dynamodb:UpdateItem"], Resource = data.aws_dynamodb_table.ecommerce.arn },
      { Effect = "Allow", Action = ["sns:Publish"], Resource = aws_sns_topic.orders.arn }
    ]
    admin_products = [
      { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:Scan", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"], Resource = data.aws_dynamodb_table.ecommerce.arn },
      { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.website.arn}/assets/img/products/*" }
    ]
    payment = [
      { Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = data.aws_dynamodb_table.ecommerce.arn },
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.stripe.arn }
    ]
    stripe_webhook = [
      { Effect = "Allow", Action = ["dynamodb:UpdateItem"], Resource = data.aws_dynamodb_table.ecommerce.arn },
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.stripe.arn },
      { Effect = "Allow", Action = ["sns:Publish"], Resource = aws_sns_topic.orders.arn }
    ]
    notification = [
      { Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = data.aws_dynamodb_table.ecommerce.arn },
      { Effect = "Allow", Action = ["sns:Publish"], Resource = aws_sns_topic.orders.arn }
    ]
    order_notification = [
      { Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = data.aws_dynamodb_table.ecommerce.arn },
      { Effect = "Allow", Action = ["ses:SendEmail"], Resource = "arn:aws:ses:${var.dr_region}:${var.aws_account_id}:identity/${var.ses_from_email}" }
    ]
  }
}

resource "aws_iam_role_policy" "lambda" {
  for_each = local.lambdas
  name     = "bmazon-dr-${replace(each.key, "_", "-")}-permissions"
  role     = aws_iam_role.lambda[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.lambda[each.key].arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      }
    ], local.lambda_permissions[each.key])
  })
}

resource "aws_lambda_function" "app" {
  for_each         = local.lambdas
  function_name    = local.lambda_names[each.key]
  role             = aws_iam_role.lambda[each.key].arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = each.value.handler
  filename         = data.archive_file.backend.output_path
  source_code_hash = data.archive_file.backend.output_base64sha256
  memory_size      = 256
  timeout          = each.value.timeout
  tracing_config { mode = "Active" }

  environment {
    variables = merge(
      {
        TABLE_NAME        = data.aws_dynamodb_table.ecommerce.name
        IDEMPOTENCY_TABLE = aws_dynamodb_table.idempotency.name
        ORDER_TOPIC_ARN   = aws_sns_topic.orders.arn
      },
      contains(["payment", "stripe_webhook"], each.key) ? {
        STRIPE_SECRET_ID = aws_secretsmanager_secret.stripe.arn
      } : {},
      contains(["payment", "order_notification"], each.key) ? {
        FRONTEND_URL = local.frontend_origin
      } : {},
      each.key == "order_notification" ? {
        FROM_EMAIL = var.ses_from_email
      } : {},
      each.key == "admin_products" ? {
        WEBSITE_BUCKET_NAME = aws_s3_bucket.website.id
        FRONTEND_URL        = local.frontend_origin
      } : {}
    )
  }

  depends_on = [aws_iam_role_policy.lambda]
}

resource "aws_lambda_permission" "api" {
  for_each      = toset(distinct([for route in values(local.routes) : route.function]))
  statement_id  = "AllowDrApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.app[each.value].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

resource "aws_lambda_permission" "sns" {
  statement_id  = "AllowDrOrderTopic"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.app["order_notification"].function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.orders.arn
}

resource "aws_sns_topic_subscription" "order_email" {
  topic_arn  = aws_sns_topic.orders.arn
  protocol   = "lambda"
  endpoint   = aws_lambda_function.app["order_notification"].arn
  depends_on = [aws_lambda_permission.sns]
}
