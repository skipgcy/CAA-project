# AWS deployment audit

Audit date: 2026-07-04

This document records the deployed state observed with a read-only AWS profile. It contains no credentials or customer data.

## Deployed

- S3 bucket `chenyu-caa900-project` with static website hosting and AES-256 server-side encryption.
- HTTP API `Bmazon-api`, stage `prod`.
- Product routes: `GET /products`, `GET /products/{id}`.
- Checkout routes: `POST /orders`, `POST /payment`, `POST /notification`.
- Lambda functions for products, order, payment, notification, and seed data.
- DynamoDB tables `Ecommerce` and `OrderIdempotency`, both on-demand.
- SNS topic `order-notification` with email and Lambda subscriptions.
- Cognito user pools in `us-east-1` and `us-east-2`.

## Confirmed gaps

- No CloudFront distribution is deployed.
- The S3 bucket is public and all four Public Access Block settings are disabled.
- API Gateway has no CORS configuration, access logging, or Cognito authorizer.
- All application API routes currently use `AuthorizationType: NONE`.
- No CloudWatch alarms are configured and Lambda log groups have no retention policy.
- The deployed resources are not represented by Terraform in this repository.
- Two Cognito pools in different regions create an ambiguous authentication source.
- The order Lambda uses broad managed policies (`AmazonDynamoDBFullAccess_v2` and `AmazonSNSFullAccess`) instead of least-privilege resource policies.
- Historical order logs show missing `dynamodb:PutItem` and `sns:Publish` permissions. Later invocations succeeded after broad policies were attached.
- Historical notification logs show a JavaScript syntax error before later successful invocations.

## Recommended remediation order

1. Commit all Lambda source and frontend configuration to GitHub.
2. Select one Cognito pool in `us-east-1`, add a JWT authorizer, and protect order/profile routes.
3. Add explicit API CORS origins and access logs.
4. Replace broad Lambda role policies with table/topic-scoped permissions.
5. Put the private S3 origin behind CloudFront using Origin Access Control.
6. Add CloudWatch alarms and log retention.
7. Import existing resources into Terraform before allowing Terraform to change them.
8. Add GitHub Actions with OIDC rather than long-lived AWS access keys.
