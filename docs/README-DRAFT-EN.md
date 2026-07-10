# Bmazon

Bmazon is the e-commerce application I built for my CAA900 capstone project. My main goal was to build more than a static storefront: I wanted a complete order flow with user accounts, trusted server-side pricing, real payment processing, inventory updates, order history, admin fulfillment, and email notifications.

Live site: [https://ezei.shop](https://ezei.shop)

## What the application does

A visitor can browse products and keep a cart in the browser. Checkout requires a Cognito account. When an order is submitted, the backend reloads each product from DynamoDB instead of trusting prices sent by the browser. It calculates HST and shipping, checks stock, and writes the order and inventory changes in one DynamoDB transaction.

Payment is handled by Stripe Checkout. Card details go directly to Stripe and are never stored by this project. A signed Stripe webhook changes the order to `PAID`; the success page alone cannot confirm payment. Customers can then see their real order history and order details.

An administrator in the Cognito `Admins` group can move a paid order through:

```text
PAID → PROCESSING → SHIPPED → DELIVERED
```

Each valid status change publishes an SNS event. A separate Lambda reads the order and sends an HTML and plain-text email through SES.

## Architecture

```text
Route 53
├── ezei.shop → CloudFront → private S3 frontend
└── api.ezei.shop → API Gateway HTTP API → Lambda
                                            ├── DynamoDB
                                            ├── Cognito
                                            ├── Secrets Manager → Stripe
                                            └── SNS → Lambda → SES
```

The project uses:

- Bootstrap and vanilla JavaScript for the frontend
- Amazon S3 and CloudFront for static hosting
- Amazon Cognito with Authorization Code + PKCE
- API Gateway HTTP API with a Cognito JWT authorizer
- AWS Lambda with the Node.js 22 runtime
- DynamoDB for products, orders, inventory, and idempotency records
- Stripe Checkout and a signature-verified webhook
- SNS and SES for asynchronous order emails
- Route 53 and ACM for custom domains and HTTPS
- AWS SAM/CloudFormation for the deployed infrastructure
- Terraform as a validated alternative IaC implementation
- GitHub Actions with AWS OIDC for CI/CD

I deliberately did not add AWS WAF. This is a low-traffic school demonstration, and its recurring cost did not make sense for the scope. The application still uses HTTPS, a private S3 origin, JWT validation, ownership checks, input validation, least-privilege Lambda roles, Secrets Manager, and Stripe webhook signatures.

## API routes

| Method | Route | Access | Purpose |
|---|---|---|---|
| GET | `/products` | Public | List products and current stock |
| GET | `/products/{id}` | Public | Read one product |
| POST | `/orders` | Signed-in user | Validate and create an order |
| GET | `/orders` | Signed-in user | List the current user's orders |
| GET | `/orders/{id}` | Order owner | Read one order |
| POST | `/payment` | Order owner | Create a Stripe Checkout Session |
| POST | `/stripe/webhook` | Stripe signature | Confirm a successful payment |
| POST | `/orders/{id}/notifications` | Order owner | Queue an order email again |
| GET | `/admin/orders` | Admin group | List all orders |
| PATCH | `/admin/orders/{id}` | Admin group | Advance order status |

## Important design decisions

### The backend owns prices

The cart is stored in localStorage, which means a user can edit it. The order Lambda only accepts product IDs and quantities as useful input. It loads the current product records from DynamoDB and calculates the final amount itself.

### Inventory and order creation are atomic

Product stock updates, the new order, and the idempotency record are written in one DynamoDB transaction. Each stock update has a `stock >= quantity` condition. If any product is unavailable, the complete transaction fails and no partial order is left behind.

### Payment confirmation comes from Stripe

The frontend redirects the customer to Stripe's hosted Checkout page. After payment, Stripe sends a server-to-server event. The webhook Lambda verifies the raw request body with the Stripe signing secret before updating the order.

### Email is asynchronous

The order and payment Lambdas publish events to SNS rather than waiting for SES. A separate subscriber Lambda builds and sends the email. This keeps payment and order APIs independent from email delivery time.

### The S3 bucket is private

CloudFront accesses S3 through Origin Access Control. Product images and pages are served from the CloudFront domain, not public S3 object URLs.

## Repository layout

```text
assets/js/                  Frontend authentication, cart, checkout and order UI
backend/functions/          Lambda handlers
backend/shared/             DynamoDB, HTTP and Stripe helpers
infra/template.yaml         SAM backend and API definition
infra/domain-template.yaml  CloudFront, Route 53 and API custom domain
infra/github-oidc-template.yaml
                             GitHub/AWS deployment roles
terraform/                  Terraform version of the architecture
tests/                      Node test-runner tests
docs/                       Audit and detailed project reports
```

## Running the checks locally

Requirements:

- Node.js 22 or newer
- AWS SAM CLI
- Terraform if the Terraform configuration is being checked

Run the application tests:

```bash
npm test
```

Validate and build the SAM backend:

```bash
sam validate --template-file infra/template.yaml --lint
sam validate --template-file infra/domain-template.yaml --lint
sam build --template-file infra/template.yaml --parallel
```

Validate Terraform without creating resources:

```bash
cd terraform
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
```

## Deployment notes

The current production environment is managed by SAM/CloudFormation. The Terraform files are included to demonstrate the same architecture in Terraform, but they have not been applied to the existing production resources. Applying both tools to the same resources without a planned import would create an ownership conflict.

Deployment configuration contains account-specific resource IDs, but Stripe keys and webhook secrets are not stored in the repository. They are loaded from AWS Secrets Manager at runtime.

GitHub Actions assumes an AWS role through OIDC, so the repository does not need permanent AWS access keys. At the time of this draft, the production deployment workflow has an open IAM issue: its CloudFormation execution role needs permission to create a change set for the SAM transform. The application itself is deployed, but I would fix that permission before describing the deployment pipeline as fully green.

## Current limitations

This is a capstone system, not a finished commercial store. The main improvements I would make next are:

- release inventory when a pending payment is abandoned
- make Stripe webhook event processing strictly idempotent
- replace the product table scan with a DynamoDB query
- add pagination and a user-oriented order index
- store all money as integer cents
- add SNS/Lambda dead-letter handling and more alarms
- add end-to-end tests for Cognito, Stripe test mode, and the complete order flow
- clean up a few older static product pages and remaining character-encoding artifacts

I kept these limitations visible because they show where a demonstration architecture would need to change before becoming a production commerce platform.

## Documentation

- [Complete Chinese technical report](PROJECT-DEEP-DIVE-ZH.md)
- [Complete English technical report](PROJECT-DEEP-DIVE-EN.md)
- [AWS audit](AWS-AUDIT.md)

## Author

Designed and developed by Chenyu for the CAA900 Capstone Project.
