# Bmazon / CAA900 Complete Technical Deep Dive

> Baseline: repository source as of July 5, 2026. This report describes the implementation that actually exists. Production is served at `https://ezei.shop`; the API uses `https://api.ezei.shop`.

## 1. What the system is

Bmazon is a low-cost serverless e-commerce demonstration. A Bootstrap frontend is delivered from a private S3 bucket through CloudFront. Cognito authenticates users. API Gateway HTTP API routes requests to Node.js Lambda functions. DynamoDB stores products, orders, and idempotency records. Stripe Checkout handles card payment. SNS distributes order events, and SES sends HTML and plain-text emails. Route 53 and ACM provide DNS and TLS.

The complete purchase path is:

```text
Browse → Cognito/PKCE login → create order + atomic inventory reservation
→ Stripe hosted Checkout → signed Stripe webhook → PAID
→ SNS event → SES confirmation
→ admin PROCESSING → SHIPPED → DELIVERED → status emails
```

## 2. Design goals and boundaries

The project is optimized for a capstone demonstration: meaningful cloud components, strong security fundamentals, little idle infrastructure, and enough operational detail to discuss in a presentation. Serverless was chosen instead of EC2 because there is no always-running OS or web server to patch and pay for. DynamoDB was chosen instead of RDS because the access patterns are small and predictable and no relational joins are needed.

The browser is an untrusted boundary. It may submit product IDs and quantities, but the backend reloads names, prices, and stock and calculates all totals. Stripe secret material never reaches JavaScript. A browser redirect never confirms payment; only a signature-verified server-to-server webhook can do that.

AWS WAF is deliberately not used. There are no CloudFront or regional Web ACLs and no WAF resource in the IaC. For a low-traffic school demonstration, JWT validation, ownership checks, input limits, HTTPS, private S3, least-privilege roles, and Stripe HMAC cover the educational security goals without WAF's recurring cost.

## 3. Architecture

```text
Browser
  ├── ezei.shop ── Route 53 ── CloudFront ── OAC/SigV4 ── private S3
  ├── Cognito Hosted UI ── Authorization Code + PKCE ── JWT
  └── api.ezei.shop ── API Gateway HTTP API
                           ├── public product Lambdas
                           ├── JWT-protected business Lambdas ── DynamoDB
                           ├── Payment Lambda ── Secrets Manager ── Stripe API
                           └── public Stripe webhook (HMAC protected)
                                      └── DynamoDB + SNS ── Email Lambda ── SES
```

### Responsibility separation

- CloudFront/S3: static presentation only.
- Cognito: identity and group claims.
- API Gateway: routing, JWT validation, CORS, access logs.
- Lambda: validation, authorization beyond basic identity, and business rules.
- DynamoDB: trusted product and order state.
- Stripe: payment data and card processing.
- SNS: asynchronous event boundary.
- SES: email delivery.
- CloudFormation/SAM: current production resource ownership.
- Terraform: validated alternative IaC representation; not applied to the existing production resources.

## 4. Frontend design

The frontend uses static HTML, Bootstrap, and vanilla JavaScript. This makes S3 hosting simple and keeps attention on cloud architecture. The trade-off is repeated HTML, inline scripts, no component system, and limited type safety.

`config.js` contains public configuration: API origin, Cognito IDs/URLs, currency, tax, and shipping settings. These are not secrets. `auth.js` performs PKCE login and token handling. `store.js` manages a localStorage cart and normalizes old image URLs. `checkout.js` creates an order, then asks the backend for a Stripe Checkout URL. The orders and admin scripts render API data dynamically.

The cart belongs in localStorage because anonymous visitors can use it and there is no database cost. It is intentionally not trusted. A user can edit localStorage, which is why the backend discards client prices.

Product pages request inventory with `cache: "no-store"`. A zero-stock product is marked Sold out and its purchase buttons are disabled. This improves the UI, but the real overselling protection remains the DynamoDB condition because two clients can still see the same last item.

## 5. Authentication and authorization

The static site is a public OAuth client and cannot protect a client secret. Authorization Code with PKCE creates a random verifier and sends only its SHA-256 challenge during authorization. The callback must present the verifier when exchanging the code. This prevents a stolen authorization code from being useful by itself.

API Gateway validates the JWT signature, issuer, audience, and lifetime. Lambda reads `requestContext.authorizer.jwt.claims`. The stable Cognito `sub`, rather than email, owns an order. Email can change; `sub` is designed as an immutable user identifier.

JWT authentication answers “who is calling?” Additional checks answer “may this caller perform this operation?” Order functions compare `owner` to `sub`. Admin functions require the `Admins` Cognito group. Returning 404 for somebody else's order avoids confirming that the order exists.

## 6. DynamoDB model and inventory consistency

The `Ecommerce` table uses `PK` and `SK`:

| Entity | PK | SK | Important attributes |
|---|---|---|---|
| Product | `PRODUCT` | product ID such as `P001` | name, price, stock, image URLs, category |
| Order | `ORDER` | `ORD-<UUID>` | owner, customer snapshot, item snapshots, totals, state, dates |

The `OrderIdempotency` table uses a key shaped as `IDEMP#<sub>#<client-key>`, stores the resulting order ID, and has a 24-hour `expiresAt`. A repeated request returns the first order rather than reserving inventory twice.

Order creation builds one DynamoDB transaction containing one conditional stock update per product, the order Put, and the idempotency Put. Stock is decremented only when `stock >= requestedQuantity`. All actions commit or all roll back, which prevents partial inventory updates and overselling under concurrency.

The current meaning is reservation at order creation, before Stripe payment. It protects the shopper while they are in Checkout but abandoned payments do not automatically release stock. A production extension would expire pending reservations and run a compensating transaction. Deducting only after payment avoids abandonment leakage but can produce the worse outcome of accepting money when inventory has just disappeared.

The single-table layout is compact but not optimized for large scale. User order listing queries the shared `ORDER` partition and applies a filter. A production model should use `USER#<sub>` as a partition key or an owner/time GSI, and all list functions should paginate.

## 7. API Gateway, field by field

### Why HTTP API

HTTP API is cheaper and simpler than API Gateway REST API and supports native JWT authorizers. This project does not need usage plans, API keys, mapping templates, or REST API request validators. An API key is not user authentication and would not replace Cognito.

### API resource

- SAM type: `AWS::Serverless::HttpApi`.
- Stage: `prod`.
- Default authorizer: Cognito JWT.
- Identity source: `$request.header.Authorization`.
- Issuer: the Cognito User Pool OIDC issuer.
- Audience: the app client ID.
- Access log group retention: 14 days.
- Log fields: request ID, route key, HTTP status, response length, integration error.

The custom regional domain `api.ezei.shop` uses TLS 1.2. `AWS::ApiGatewayV2::ApiMapping` maps the root of that domain to the `prod` stage.

### CORS

The only allowed origin is the exact production site, not `*`. Allowed headers are `authorization`, `content-type`, `idempotency-key`, and `stripe-signature`. Methods are GET, POST, PATCH, and OPTIONS. Preflight results are cached for 600 seconds. CORS is a browser policy; it is not authentication and does not protect the Stripe webhook.

### Route map

| Method and route | Authentication | Integration | Purpose |
|---|---|---|---|
| `GET /products` | Public | ProductFunction | List products and stock |
| `GET /products/{id}` | Public | GetProductFunction | Product details |
| `POST /orders` | JWT | OrderFunction | Validate, reserve stock, create order |
| `GET /orders` | JWT | OrderFunction | Current user's orders |
| `GET /orders/{id}` | JWT + ownership | OrderFunction | Current user's order detail |
| `POST /payment` | JWT + ownership | PaymentFunction | Stripe Checkout Session |
| `POST /stripe/webhook` | Stripe HMAC | StripeWebhookFunction | Confirm paid session |
| `POST /orders/{id}/notifications` | JWT + ownership | NotificationFunction | Queue a notification again |
| `GET /admin/orders` | JWT + Admins group | AdminOrdersFunction | All orders |
| `PATCH /admin/orders/{id}` | JWT + Admins group | AdminOrdersFunction | Advance fulfillment state |

Public product routes explicitly set `Authorizer: NONE`. The webhook also sets NONE because Stripe has no Cognito identity; its raw-body HMAC is the appropriate authentication method.

## 8. Shared backend modules, line by line

Blank lines and closing punctuation are described with their surrounding statement. Line numbers refer to the current repository.

### `shared/data.mjs`, lines 1–26

| Lines | Detailed behavior |
|---|---|
| 1–2 | Import the low-level DynamoDB client, DocumentClient, and GetCommand. DocumentClient converts normal JavaScript values to/from AttributeValue objects. |
| 4–5 | Read both table names from environment variables, with local defaults. |
| 7 | Create the SDK client outside the handler so warm Lambda invocations reuse it. Region and credentials come from the Lambda environment and execution role. |
| 8–10 | Create the document wrapper and remove undefined values during marshalling. |
| 12–18 | Get exactly one product using `PK=PRODUCT` and its product ID as SK; return null when absent. |
| 20–26 | Get exactly one order using `PK=ORDER` and order ID as SK. |

### `shared/http.mjs`, lines 1–43

| Lines | Detailed behavior |
|---|---|
| 1–7 | Create a Lambda proxy response with JSON content type and serialized body. API Gateway owns CORS headers. |
| 9–10 | Treat an absent body as an empty object. |
| 11–15 | Decode base64 when necessary and parse JSON. |
| 16–20 | Convert malformed JSON into a controlled HTTP 400. |
| 23–25 | Read claims from the HTTP API JWT authorizer context. |
| 27–35 | Require a Cognito `sub`; otherwise throw a 401. Return claims for later ownership and group checks. |
| 37–39 | Use an explicit business status or default to 500; log server errors. |
| 40–42 | Return useful 4xx messages but replace 5xx details with a generic message to avoid leaking internals. |

### `shared/stripe.mjs`, lines 1–54

| Lines | Detailed behavior |
|---|---|
| 1–2 | Import HMAC/timing-safe crypto and Secrets Manager SDK. |
| 4–5 | Create a reusable client and module-level secret cache. |
| 7–11 | Return cached credentials on warm invocations or request the configured secret. |
| 12 | Support string and binary secret storage. |
| 13–18 | Parse the preferred JSON format and accept two naming conventions. |
| 19–21 | Fall back to treating a non-JSON secret as the Stripe API key alone. |
| 22–24 | Fail fast when no API key exists. |
| 26–35 | Send a Stripe v1 form-encoded POST. Basic authentication encodes `<secretKey>:`. Native Node 22 fetch avoids another HTTP dependency. |
| 36–42 | Parse Stripe's response; turn an upstream rejection into 502 and preserve its safe message. |
| 45–49 | Parse timestamp/signature, require both, and reject events older/newer than the 300-second tolerance. |
| 50 | Calculate HMAC-SHA256 over `timestamp.rawBody`, exactly as Stripe requires. |
| 51–53 | Convert hex to buffers, compare length, then use constant-time equality. |

## 9. Every Lambda function, line by line

### ProductFunction, lines 1–19

| Lines | Explanation |
|---|---|
| 1–3 | Import Scan, the shared database/table, and response helpers. |
| 5–6 | Export the async SAM handler and begin error handling. |
| 7–13 | Scan the table, filter `PK=PRODUCT`, project only public product fields, and alias reserved word `name` as `#n`. |
| 14 | Normalize missing Items to an array and sort by SK for stable output. |
| 15 | Return the product array with HTTP 200. |
| 16–18 | Convert unexpected failures to safe responses. |

Scan is acceptable for nine demonstration products but reads the whole table. `Query PK = PRODUCT` is the correct scaling improvement.

### GetProductFunction, lines 1–15

| Lines | Explanation |
|---|---|
| 1–2 | Import shared product read and HTTP helpers. |
| 4–7 | Read the `{id}` path parameter and return 400 if absent. |
| 8 | Execute the exact DynamoDB GetItem. |
| 9–11 | Return 200 with the product or 404. |
| 12–14 | Safely translate exceptions. |

### OrderFunction, lines 1–152

| Lines | Explanation |
|---|---|
| 1–5 | Import UUID, DynamoDB Get/Query/transaction commands, SNS, shared data, and HTTP/auth helpers. |
| 7–8 | Reuse an SNS client and capture its topic ARN. |
| 10–12 | Accept strings only, trim, and truncate to a maximum length. |
| 14–22 | Normalize customer fields: lower-case email, upper-case province/postal code, bounded lengths. |
| 23–29 | Validate required values, basic email syntax, two-letter province, and Canadian postal format; throw 400. This is format validation, not postal-address verification. |
| 32–37 | Require 1–25 incoming item rows to bound abuse and transaction size. |
| 38–49 | Merge duplicate product IDs and require each submitted quantity to be an integer from 1–20. The merged total can currently exceed 20, a small validation gap. |
| 52–55 | Remove internal keys, owner, and payment intent before returning an order. |
| 57–63 | If an order ID is present, load one order and return it only to its owner; use 404 for absent or unauthorized. |
| 64–70 | Query all `ORDER` records and filter to the current owner. Correct for the demo, inefficient at scale. |
| 71–75 | Sort ISO timestamps descending, sanitize, and return. |
| 77–80 | Require an authenticated user for every order route; dispatch GET to read logic. |
| 81–83 | Parse and validate the create-order payload. |
| 84–88 | Read a bounded idempotency key from either header capitalization or body; require it. |
| 90–94 | Look up `sub + key`; replay the existing order instead of writing and reserving again. The hard-coded replay status can be stale after payment. |
| 96–104 | Load every product in parallel. Reject a missing product. Build trusted item snapshots from database name/price/image rather than browser values. |
| 106–109 | Compute subtotal, 13% HST, $10 shipping below $100, and total. Monetary integers in cents would be stricter than floating point. |
| 110–116 | Create a UUID order ID, timestamps, immutable item/price snapshots, and `PENDING_PAYMENT` state. |
| 118–126 | Build one conditional stock decrement per product. Existence and sufficient stock must both be true. |
| 127–134 | Add conditionally unique order and idempotency Puts to the same transaction. |
| 135 | Commit atomically: no partial stock, order, or idempotency result is possible. |
| 137–143 | Publish ORDER_CREATED after commit. A publish failure is logged but does not roll back durable commerce state. A transactional outbox would make this fully reliable. |
| 144 | Return HTTP 201 and trusted order summary. |
| 145–149 | Map transaction cancellation—stock race or duplicate—to HTTP 409. |
| 150–152 | Produce the safe final error response. |

### PaymentFunction, lines 1–40

| Lines | Explanation |
|---|---|
| 1–3 | Import trusted order read, authentication/body helpers, and Stripe request wrapper. |
| 5–10 | Add a Stripe line item, convert dollars to rounded cents, and set quantity. |
| 12–16 | Require JWT and order ID. |
| 17–20 | Require an existing order owned by the caller and reject already-paid orders. It should ideally require exactly PENDING_PAYMENT. |
| 22–29 | Configure one-time payment, reference, customer email, success/cancel URLs, and metadata used by the webhook. |
| 30–33 | Add product, HST, and shipping lines so Checkout explains the total. |
| 35–36 | Create the server-side Session and return only its ID and Stripe-hosted URL. |
| 37–39 | Safely return failures. |

Hosted Checkout keeps raw card number/CVC outside this project and substantially reduces PCI scope. A custom Elements integration offers more UI control but requires more frontend/payment-state work.

### StripeWebhookFunction, lines 1–52

| Lines | Explanation |
|---|---|
| 1–5 | Import DynamoDB update, SNS, shared data/HTTP, secret retrieval, and signature verification. |
| 7 | Reuse the SNS client. |
| 9–14 | Extract the exact raw body, decoding base64 if API Gateway used it, and find the case-variant signature header. |
| 15–18 | Load webhook secret and reject invalid HMAC with 400. This replaces Cognito for the public route. |
| 20–21 | Parse the event and acknowledge unrelated event types with 200. |
| 22–25 | Require a paid Checkout Session and recover the internal order reference. |
| 27–38 | Conditionally update an existing pending/paid order to PAID and store Stripe identifiers and timestamps; return the full updated record. |
| 40–47 | Publish ORDER_PAID for asynchronous email. |
| 48 | Acknowledge Stripe with 200. |
| 49–51 | Return an error; a 5xx response causes Stripe to retry. |

Known issue: allowing an already-PAID state means a retry can publish a duplicate email. The condition should only transition PENDING_PAYMENT; a condition failure should return 200 without publish when the order is already paid. Storing Stripe `event.id` provides event-level idempotency.

### NotificationFunction, lines 1–23

| Lines | Explanation |
|---|---|
| 1–3 | Import SNS, order access, JWT/HTTP helpers. |
| 5 | Reuse the SNS client. |
| 7–13 | Authenticate, load the path order, and enforce ownership. |
| 14–18 | Publish an ORDER_STATUS message with the current state and summary. |
| 19 | Return 202 Accepted: queued, not necessarily delivered. |
| 20–22 | Safely handle errors. |

### OrderNotificationFunction, lines 1–71

| Lines | Explanation |
|---|---|
| 1–4 | Import SES/order access and instantiate SES outside the handler. |
| 5–7 | Format currency with the Canadian locale. |
| 9–13 | Escape all dynamic text inserted into HTML. |
| 15–24 | Select heading and introduction for payment and each fulfillment state. |
| 25–26 | Build subject and authenticated order-detail URL. The current source contains an encoding artifact around the subject dash and should be cleaned. |
| 27–30 | Render escaped order items as email table rows. |
| 31–42 | Build table-based HTML with inline styles for broad email-client support. Bootstrap is unsuitable inside email clients. |
| 43–45 | Build a plain-text alternative for accessibility and deliverability. |
| 46–47 | Return subject, HTML, and text. |
| 49–53 | Iterate the SNS batch, parse each message, and skip incomplete configuration. |
| 54–56 | Reload the complete trusted order and generate content. |
| 57–67 | Send UTF-8 HTML and text through SES from the configured verified identity. |
| 68–70 | Count processed messages and return. |

### AdminOrdersFunction, lines 1–31

| Lines | Explanation |
|---|---|
| 1–5 | Import database/SNS/HTTP dependencies and reuse SNS. |
| 6 | Declare the only legal transitions: PAID→PROCESSING→SHIPPED→DELIVERED. |
| 7–11 | Require a user, normalize the Cognito groups claim, and require `Admins`. |
| 12 | Strip internal order fields. |
| 13–16 | Query and sort all orders. Pagination is currently missing after DynamoDB's 1 MB response boundary. |
| 17–20 | Normalize order ID/target, ensure target belongs to the state machine, reverse-map its required previous state, and timestamp. |
| 21–23 | Conditionally update only if the database still has the expected previous state; this prevents concurrent lost updates and skipped states. |
| 24–27 | Publish the new status and return the updated public order. |
| 29–30 | Dispatch GET/PATCH or return 405. |
| 31 | Convert a conditional race to 409 and all other errors safely. |

## 10. Payment and notification state machines

```text
PENDING_PAYMENT --trusted Stripe webhook--> PAID
PAID --admin conditional PATCH--> PROCESSING
PROCESSING --admin conditional PATCH--> SHIPPED
SHIPPED --admin conditional PATCH--> DELIVERED
```

The success browser page is informational only. This is essential because a shopper can type any success URL. State transitions use conditions so stale admin pages cannot overwrite newer state.

SNS separates durable business work from email. Order/payment/admin Lambdas only publish. The email Lambda alone has SES permission. This shortens APIs and makes adding another subscriber possible. SES permission is also constrained by `ses:FromAddress`.

## 11. CDN, domains, and TLS

CloudFront reads the private S3 origin through Origin Access Control with SigV4. Direct S3 URLs therefore return 403 by design. Product URLs use the CloudFront site origin, and frontend compatibility code rewrites old stored S3 URLs.

CloudFront enables HTTP/2 and HTTP/3, IPv6, HTTPS redirects, compression, TLS 1.2 (2021 policy), and a managed security response-header policy. PriceClass_100 favors cost over global edge coverage. A lightweight CloudFront Function permanently redirects `www.ezei.shop` to the apex domain without Lambda@Edge cost.

Route 53 A and AAAA alias records support both the zone apex and IPv6. The website certificate used by CloudFront must be in us-east-1. The regional API custom domain uses an ACM certificate in the API region. DNS validation supports managed renewal while validation records remain.

## 12. IAM

Each SAM function receives only the service actions it needs. Product functions read DynamoDB. Order reads/writes its two tables and publishes SNS. Payment reads orders and reads one Stripe secret. Webhook writes the order, reads the secret, and publishes. The email consumer reads orders and may send only from the configured SES address.

GitHub Actions uses OIDC temporary credentials instead of stored access keys. A GitHub deploy role can start CloudFormation and pass a separate execution role. Trust is limited to this repository's main branch/production environment.

Known deployment ticket: workflow run 28747806998 failed because `bmazon-cloudformation-execution` cannot call `cloudformation:CreateChangeSet` on the SAM transform ARN. The Node 20 annotation is a warning, not the exit-code cause. The actual IAM role and its IaC need the transform permission; action versions should then be moved to Node 24-based majors. CI/CD should not be presented as currently green until that is done.

## 13. IaC and CI/CD

SAM/CloudFormation currently owns production. `template.yaml` defines functions, routes, authorizers, logs, alarm, and permissions. `domain-template.yaml` defines OAC, CloudFront, Route 53, API domain, mapping, and certificates. `github-oidc-template.yaml` defines CI identities.

Terraform expresses the same target architecture and has passed format/validate, but it has not been applied. Applying it over CloudFormation-owned resources without import would create ownership conflicts. A safe migration requires imports and a no-change plan before changing control.

CI runs unit/source tests, SAM lint/build, and Terraform format/init/validate. Deployment runs on main and uses OIDC, then backend → domain → frontend → CloudFront invalidation. Production concurrency is serialized. The ordering prevents a frontend from depending on an API that is not deployed yet.

## 14. Testing and observability

The dependency-free Node test runner covers cart limits, HTTP parsing/auth/error hiding, production domains, SAM routes and CORS, inventory transaction source rules, storefront stock behavior, and legacy attribution cleanup. These tests are quick, but source assertions are not integration tests.

Useful next tests are: mocked trusted-price order creation, a real concurrent last-item race, webhook duplicate delivery, forbidden state skipping, and Playwright checkout with Stripe test fixtures.

API access logs are structured JSON and retained 14 days. Lambda tracing is active. The order Lambda has an error alarm, but the alarm currently has no notification action. Business logs should add correlation IDs/order IDs while avoiding addresses, tokens, and card data.

## 15. Security review

| Risk | Present defense | Remaining work |
|---|---|---|
| Price tampering | Backend reloads product and recalculates | Store amounts as integer cents |
| Anonymous business calls | API Gateway JWT | Product routes intentionally public |
| Cross-user order access | `owner === sub` | Dedicated admin detail route needed |
| Fake payment | Stripe raw-body HMAC and tolerance | Event ID idempotency |
| Overselling | Conditional atomic transaction | Release abandoned reservations |
| XSS | Escaping in dynamic order/admin/email views | Escape product-card interpolation consistently |
| Secret exposure | Secrets Manager and scoped IAM | Rotation workflow |
| Origin bypass | Private S3 + OAC | Preserve Block Public Access |
| Traffic abuse | No WAF by cost decision | Budgets, throttling, teardown after demo |
| Duplicate order | User-scoped idempotency table | Improve stale replay status |

## 16. Cost posture

The architecture avoids continuously running compute, NAT Gateway, RDS, WAF, OpenSearch, and Kubernetes. Lambda uses arm64, 256 MB, and a 10-second timeout. CloudFront uses PriceClass_100. Logs expire after 14 days. Most runtime services charge by request/storage/transfer at this scale. Domain registration, the Route 53 hosted zone, and Secrets Manager are more predictable recurring items. An AWS Budget alert is still recommended.

## 17. Honest limitations and roadmap

Highest priority: repair the CI execution-role permission and return the production workflow to green.

Next: make Stripe webhook processing idempotent, expire/release abandoned inventory, replace product Scan with Query, redesign/paginate order access, enforce PENDING_PAYMENT in Payment, convert money to cents, add an SNS dead-letter path, fix encoding artifacts, and escape product rendering consistently.

Later: refund/cancellation compensation, SES bounce/complaint handling, end-to-end tests, separate dev/prod stacks, versioned static assets, and richer alarms.

## 18. Presentation questions you should be able to answer

1. Why not trust frontend totals? The browser is user-controlled; the backend reloads and calculates.
2. Why not mark paid on the success page? Redirects can be forged; only the Stripe HMAC webhook is authoritative.
3. How is overselling prevented? All conditional decrements and order writes are one DynamoDB transaction.
4. How are duplicate orders prevented? A user-scoped idempotency key and conditional Put.
5. Why is the webhook public? Stripe is not a Cognito user; HMAC authenticates the sender/message.
6. Why SNS? It decouples state changes from slow/failing email and isolates SES permission.
7. Why is S3 private? CloudFront OAC prevents bypassing the chosen HTTPS/domain/header boundary.
8. Why no WAF? It is a conscious cost decision for a low-traffic educational system.
9. Are SAM and Terraform both managing production? No. CloudFormation owns it; Terraform is an unapplied, validated alternative.
10. What are the biggest debts? Reservation expiry, webhook idempotency, DynamoDB access patterns, and the CI IAM ticket.

If you can narrate the purchase flow and explain every deliberate indirection—server-side pricing, hosted card entry, signed webhook, asynchronous email, private origin—you understand the engineering, not merely the service names.
