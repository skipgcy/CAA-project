data "archive_file" "backend" {
  type        = "zip"
  source_dir  = "${path.module}/../backend"
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
  name               = "bmazon-${replace(each.key, "_", "-")}-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "lambda" {
  for_each = local.lambdas
  name     = "bmazon-${replace(each.key, "_", "-")}-permissions"
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

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.lambdas
  name              = "/aws/lambda/${var.lambda_function_names[each.key]}"
  retention_in_days = 14
}

resource "aws_lambda_function" "app" {
  for_each         = local.lambdas
  function_name    = var.lambda_function_names[each.key]
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
    variables = merge({
      TABLE_NAME        = aws_dynamodb_table.ecommerce.name
      IDEMPOTENCY_TABLE = aws_dynamodb_table.idempotency.name
      ORDER_TOPIC_ARN   = aws_sns_topic.orders.arn
      }, contains(["payment", "stripe_webhook"], each.key) ? {
      STRIPE_SECRET_ID = aws_secretsmanager_secret.stripe.arn
      } : {}, contains(["payment", "order_notification"], each.key) ? {
      FRONTEND_URL = local.frontend_origin
      } : {}, each.key == "order_notification" ? {
      FROM_EMAIL = var.ses_from_email
      } : {}, each.key == "admin_products" ? {
      WEBSITE_BUCKET_NAME = aws_s3_bucket.website.id
      FRONTEND_URL         = local.frontend_origin
    } : {})
  }

  depends_on = [aws_iam_role_policy.lambda]
}

resource "aws_lambda_permission" "api" {
  for_each      = local.lambdas
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.app[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

resource "aws_lambda_permission" "sns" {
  statement_id  = "AllowOrderTopic"
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

resource "aws_cloudwatch_metric_alarm" "order_errors" {
  alarm_name          = "bmazon-order-errors"
  alarm_description   = "Order Lambda errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.app["orders"].function_name }
}
