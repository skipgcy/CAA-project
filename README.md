# Bmazon — CAA900 Capstone Project

Bmazon is a production-style serverless e-commerce application built by Chenyu for the CAA900 capstone project.

## Live application

- Website: <https://ezei.shop>
- API: <https://api.ezei.shop>

## Architecture

- Bootstrap 5 frontend delivered through CloudFront from a private S3 bucket
- Route 53, ACM certificates, apex domain, and `www` redirect
- API Gateway HTTP API protected by Cognito JWT authorization
- Node.js 22 Lambda functions deployed with AWS SAM
- DynamoDB products, orders, inventory, and idempotency records
- Stripe Checkout and signed Stripe webhooks
- SNS events and SES responsive HTML order emails
- Cognito `Admins` group and protected order fulfilment workflow
- CloudWatch access logs, tracing, and alarms

## Customer flow

1. Register or sign in through Cognito Authorization Code + PKCE.
2. Browse live products and maintain a browser shopping cart.
3. Submit an idempotent, server-priced order with stock reservation.
4. Pay through Stripe Checkout.
5. Review live order history and details.
6. Receive payment and fulfilment email notifications.

Administrators can move paid orders through `PROCESSING`, `SHIPPED`, and `DELIVERED`. Every successful transition publishes a notification event.

## Development and validation

Requires Node.js 22 and AWS SAM CLI.

```powershell
npm test
sam validate --template-file infra/template.yaml --lint
sam build --template-file infra/template.yaml --parallel
```

Serve the frontend through HTTP rather than opening files with `file://`:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

## CI/CD

- `.github/workflows/ci.yml` runs unit tests, IaC lint, and a complete SAM build.
- `.github/workflows/deploy.yml` deploys `main` to AWS using GitHub OIDC short-lived credentials.
- `infra/github-oidc-template.yaml` defines the repository trust and deployment roles.

No AWS access keys or Stripe secret values are stored in this repository. Runtime settings are in `assets/js/config.js`; Stripe values remain in AWS Secrets Manager.
