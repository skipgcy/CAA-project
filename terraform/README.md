# Bmazon Terraform

This directory is a Terraform representation of the Bmazon AWS architecture:

- private S3 and CloudFront OAC
- Route 53, ACM, apex/`www`, and API custom domains
- Cognito user pool, public PKCE client, and administrator group
- DynamoDB, Secrets Manager metadata, SNS, SES, Lambda, API Gateway, logs, and alarms
- GitHub Actions OIDC deployment identity

Terraform intentionally creates the Stripe **secret container only**. Populate `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` outside Terraform so secret values never enter source control or Terraform state.

## Fresh environment

```powershell
Copy-Item terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check
terraform validate
terraform plan
```

Review the plan before applying. The Route 53 public hosted zone must already exist and the Cognito domain prefix and S3 bucket name must be globally unique.

## Existing production environment

The current `ezei.shop` production resources are owned by CloudFormation/SAM. **Do not run `terraform apply` against them directly.** Terraform does not automatically take ownership of existing resources.

Safe migration procedure:

1. Back up CloudFormation templates and Terraform state remotely.
2. Set every variable to the existing physical resource name.
3. Add/import one resource at a time with `terraform import`.
4. Run `terraform plan` after every import.
5. Resolve all drift until the plan shows no replacement or deletion.
6. Only then remove the corresponding resource from CloudFormation with a retain policy.

Example imports:

```powershell
terraform import aws_s3_bucket.website chenyu-caa900-project
terraform import aws_dynamodb_table.ecommerce Ecommerce
terraform import aws_dynamodb_table.idempotency OrderIdempotency
terraform import aws_sns_topic.orders arn:aws:sns:us-east-1:ACCOUNT_ID:order-notification
terraform import aws_apigatewayv2_api.http API_ID
terraform import aws_cloudfront_distribution.website DISTRIBUTION_ID
```

State can contain infrastructure metadata and must be stored in an encrypted, access-controlled backend. A backend is deliberately not hard-coded here so the owner can choose the state bucket and locking strategy.
