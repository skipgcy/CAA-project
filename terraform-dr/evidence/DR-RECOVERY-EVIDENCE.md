# Bmazon DR Recovery Evidence

Date: July 21, 2026
AWS account: `563960656220`
Source Region: `us-east-1`
Recovery Region: `us-east-2`

## Terraform bootstrap

- Plan: `5 to add, 0 to change, 0 to destroy`
- Apply: `5 added, 0 changed, 0 destroyed`
- Source vault: `bmazon-dr-source-vault`
- Destination vault: `bmazon-dr-us-east-2-vault`
- Temporary role: `bmazon-dr-aws-backup-role`
- No scheduled backup plan or permanent selection was attached to the production table.

## One-time database recovery

- Source table: `arn:aws:dynamodb:us-east-1:563960656220:table/Ecommerce`
- Backup job: `67e057a8-ef1e-4990-8d9a-3228c73d1e7c`
- Source recovery point: `arn:aws:backup:us-east-1:563960656220:recovery-point:3010c922-2c52-4a84-be05-5bb65573be78`
- Backup result: `COMPLETED`, `100%`
- Copy job: `8355d71d-4fa8-4830-90c4-96baed29f7bb`
- Destination recovery point: `arn:aws:backup:us-east-2:563960656220:recovery-point:ad53b5f3-4d85-4c74-8b7d-eed19657f646`
- Copy result: `COMPLETED`
- Restore job: `50c13c31-6046-41e8-b160-29bc223e70f8`
- Restored table: `arn:aws:dynamodb:us-east-2:563960656220:table/Ecommerce-DR`
- Restore result: `COMPLETED`, `100%`

## Data validation

| Check | Production | Restored DR | Result |
|---|---:|---:|---|
| Consistent table scan count | 21 | 21 | PASS |
| Partition key | `PK` | `PK` | PASS |
| Sort key | `SK` | `SK` | PASS |
| Billing mode | `PAY_PER_REQUEST` | `PAY_PER_REQUEST` | PASS |
| Table status | `ACTIVE` | `ACTIVE` | PASS |

The DynamoDB `DescribeTable.ItemCount` field is updated approximately every six hours and may temporarily display zero immediately after restoration. A strongly consistent `Scan --select COUNT` returned 21 items from both tables and is the validation result used above.

## DR application deployment

- Terraform application plan: `108 to add, 0 to change, 0 to destroy`
- Terraform application apply: `108 added, 0 changed, 0 destroyed`
- Website: `https://dr.ezei.shop`
- API custom domain: `https://api.dr.ezei.shop`
- API Gateway default stage: `https://lr6889ous6.execute-api.us-east-2.amazonaws.com/dr`
- CloudFront distribution: `E17NKTERN5O2VK`
- Website bucket: `bmazon-dr-us-east-2-563960656220`
- Cognito User Pool: `us-east-2_NWWKWcyAL`
- Cognito client: `7uhboj40u4c9lcpg6eauv07vag`
- Lambda functions deployed: 9

## Restored application validation

| Validation | Evidence | Result |
|---|---|---|
| DR website | Homepage rendered from `https://dr.ezei.shop` with the expected Bmazon title and footer | PASS |
| Product API integration | Product page dynamically rendered 9 products with restored stock values | PASS |
| Restored data usability | Products P001 through P009 were returned through the `us-east-2` API | PASS |
| Static and product images | 21 images on the product page; 0 broken images | PASS |
| Cognito isolation | Login redirected to `ezei-shop-dr-auth.auth.us-east-2.amazoncognito.com` | PASS |
| Cognito client isolation | Authorization request used DR client `7uhboj40u4c9lcpg6eauv07vag` and DR callback URL | PASS |
| Frontend publication | DR-specific configuration and updated homepage uploaded to `bmazon-dr-us-east-2-563960656220` and CloudFront invalidated | PASS |
| Stripe webhook isolation | DR-only test endpoint `we_1TvkKJJWuXVTr7I5sM6k42Xp` configured for `https://api.dr.ezei.shop/stripe/webhook` | PASS |
| SES sender | `chenyugao.ca@gmail.com` verified in `us-east-2`; verification status `SUCCESS` | PASS |
| Authenticated checkout | Cognito-authenticated checkout reached Stripe Sandbox for CAD 43.89 | PASS |
| Stripe payment and webhook | Test payment returned to the DR confirmation page; order status changed to `PAID` | PASS |
| Order persistence | Order `ORD-0c243c8c-e62c-4100-b674-90d3a3fe9868` appeared in the authenticated order history | PASS |
| Inventory update | Product P007 stock changed from 99 to 98 for quantity 1 | PASS |
| Order email | Order confirmation email was received by the registered DR customer after payment | PASS |
| Browser runtime | Confirmation, orders, and product pages reported no console errors | PASS |
| Source tests | Node test suite: 19 passed, 0 failed | PASS |

Administrator authorization can be validated independently without affecting the successful customer checkout recovery test.

## Defects found during recovery validation

The DR exercise caught two restored-data/browser compatibility defects before final submission:

1. Legacy product rows used the DynamoDB `SK` as the product identifier. The detail page now normalizes `productId || id || SK` before adding an item to the shared cart.
2. The customer name was not restored after the Cognito OAuth round trip because the draft property `name` did not map to the form field `customerName`. An explicit field mapping and regression test were added.

Both corrections are covered by the local Node test suite.

## Production safety verification

After backup, copy, and restore, the production table remained `ACTIVE`, retained the same key schema and billing mode, and returned all 21 items. The recovery created only the separate `Ecommerce-DR` table in `us-east-2`.
