# Bmazon backend

The Lambda source is packaged as one SAM code directory so all handlers can reuse `shared/` and one dependency bundle.

## API contract

Public:

- `GET /products`
- `GET /products/{id}`
- `POST /stripe/webhook` (authenticated by Stripe signature, not Cognito)

Cognito JWT required:

- `POST /orders`
- `POST /payment`
- `POST /orders/{id}/notifications`

## Payment flow

1. The browser submits product IDs and quantities to `POST /orders`.
2. The order Lambda reloads prices from DynamoDB, checks stock, calculates HST and shipping, reserves inventory, and stores a `PENDING_PAYMENT` order in one transaction.
3. The browser passes only the resulting `orderId` to `POST /payment`.
4. The payment Lambda reloads the trusted order and creates a hosted Stripe Checkout Session.
5. Stripe sends `checkout.session.completed` to the webhook.
6. The webhook verifies `Stripe-Signature`, changes the order to `PAID`, and publishes an SNS event.
7. The SNS subscriber sends the order email through Amazon SES.

Do not fulfill an order from the success page redirect. Only the signed webhook may mark an order paid.

## Secrets Manager value

Create one secret outside source control with this JSON shape:

```json
{
  "STRIPE_SECRET_KEY": "set-in-secrets-manager",
  "STRIPE_WEBHOOK_SECRET": "set-in-secrets-manager"
}
```

Never put either value in frontend JavaScript, `samconfig.toml`, GitHub secrets as plain deployment output, or Lambda environment variables.

## Build and deploy prerequisites

- AWS SAM CLI and Node.js 22
- An SES-verified sender (and recipient verification while SES is in sandbox)
- Stripe test-mode account and webhook endpoint
- Cognito app client callback and logout URLs matching the final CloudFront origin

Use `infra/samconfig.example.toml` as a reference, but keep the real `samconfig.toml` untracked.
