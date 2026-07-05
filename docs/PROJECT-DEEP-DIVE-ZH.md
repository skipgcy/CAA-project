# Bmazon / CAA900 项目完全学习手册（中文）

> 版本基线：2026-07-05 仓库源码。本文描述的是仓库当前真实实现，而不是理想化架构。生产入口为 `https://ezei.shop`，API 为 `https://api.ezei.shop`。

## 1. 一句话理解这个项目

Bmazon 是一个低成本、无服务器电商演示系统：静态 Bootstrap 前端由 S3 + CloudFront 提供，Cognito 负责用户身份，API Gateway HTTP API 接收请求，Node.js Lambda 执行业务，DynamoDB 保存商品和订单，Stripe Checkout 完成支付，SNS 解耦订单事件，SES 发送 HTML 邮件，Route 53 + ACM 提供自定义域名与 HTTPS。

它不是一个“静态网页加几个按钮”，而是一条完整的电商主链路：

```text
浏览商品 → Cognito 登录 → 创建订单并原子扣库存 → Stripe 托管付款
       → Stripe 签名 Webhook → 订单变为 PAID → SNS → SES 邮件
       → 管理员 PROCESSING → SHIPPED → DELIVERED → 每步邮件
```

## 2. 项目目标与设计原则

### 2.1 为什么使用 Serverless

本项目是学校 Capstone，不需要全天运行的 EC2、ECS 或 Kubernetes。Serverless 的优势是：低流量时接近按请求付费；不用维护操作系统；Lambda、API Gateway、DynamoDB 天然组合；架构中每个 AWS 服务都能成为答辩中的一个明确知识点。

没有使用 EC2，是因为 EC2 即使无人访问也持续计费，还需要补丁、Web Server、进程守护和扩缩容。没有使用 RDS，是因为商品和订单访问模式简单，DynamoDB 按需模式更适合演示流量。没有使用 WAF，是明确的成本取舍：当前 CloudFront 和 Regional WAF Web ACL 均为 0；对于低流量学校展示，HTTPS、JWT、最小权限、输入校验和 Stripe 签名已经覆盖主要学习目标。

### 2.2 信任边界

浏览器永远不可信。因此前端传来的商品名称、价格、税费和总价都不能作为付款依据。`OrderFunction` 只接受 `productId + quantity`，然后从 DynamoDB 重新读取可信价格，在后端计算 subtotal、HST、shipping 和 total。Stripe Secret 只存在 Secrets Manager，绝不进入前端。

## 3. 总体架构

```text
                         ┌──────────────────────────┐
Browser ──HTTPS─────────▶│ CloudFront: ezei.shop    │
                         │ OAC → private S3 bucket  │
                         └────────────┬─────────────┘
                                      │ JS fetch + Bearer JWT
                                      ▼
                         ┌──────────────────────────┐
                         │ API Gateway HTTP API     │
                         │ api.ezei.shop / prod     │
                         │ JWT authorizer + CORS    │
                         └───┬──────────┬───────────┘
                             │          │ public webhook
                ┌────────────▼──┐   ┌──▼────────────────┐
                │ Business      │   │ Stripe Webhook    │
                │ Lambdas       │   │ HMAC verification │
                └──┬─────┬──────┘   └──┬────────────────┘
                   │     │             │
            ┌──────▼─┐ ┌─▼────────┐ ┌──▼───┐
            │DynamoDB│ │Secrets   │ │ SNS  │
            │orders/ │ │Manager   │ └──┬───┘
            │products│ │Stripe key│    ▼
            └────────┘ └──────────┘  Email Lambda → SES
```

### 3.1 请求与数据流

1. DNS：Route 53 将 `ezei.shop` 指向 CloudFront，将 `api.ezei.shop` 指向 API Gateway Regional custom domain。
2. 静态内容：CloudFront 通过 Origin Access Control（SigV4）读取私有 S3；用户不能绕过 CloudFront 直接访问 bucket。
3. 登录：前端通过 Cognito Hosted UI + Authorization Code with PKCE 获取 JWT；不在静态前端保存 client secret。
4. API：前端在 `Authorization: Bearer <token>` 中发送 access token。
5. 下单：Lambda 重新加载商品、校验库存并用 DynamoDB transaction 同时扣库存、写订单、写幂等记录。
6. 支付：Payment Lambda 从可信订单创建 Stripe Checkout Session，浏览器只负责跳转。
7. 履约：Stripe 回调公开 webhook；Lambda 验签后将订单更新为 `PAID`。
8. 通知：订单事件发布到 SNS；订阅 Lambda 从 DynamoDB读取完整订单并通过 SES 发送 HTML + text 邮件。

## 4. 前端

### 4.1 技术选择

前端使用 HTML、Bootstrap 和原生 JavaScript。优点是学习曲线低、无需 Node Web Server、可以直接部署到 S3；缺点是页面重复、内联脚本较多、缺乏组件化和强类型。没有使用 React/Vue，是为了把项目重点放在 AWS、身份、支付和事件驱动后端，而不是增加 SPA 构建复杂度。

### 4.2 关键文件

- `assets/js/config.js`：生产 API、Cognito、税率、运费和货币配置。
- `assets/js/auth.js`：PKCE、callback、token 存储、刷新/登出与登录状态。
- `assets/js/store.js`：localStorage 购物车、数量限制、旧 S3 图片 URL 兼容。
- `assets/js/checkout.js`：表单、订单 POST、Stripe Session POST、跳转。
- `assets/js/orders.js` / `order-detail.js`：动态读取当前用户订单。
- `assets/js/admin-orders.js`：管理员列表及 PATCH 状态。
- `shop.html` / `shop-product-detail.html`：从 API 实时读取库存；`cache: "no-store"` 避免显示过期库存；库存 0 时禁用购买。

### 4.3 为什么购物车使用 localStorage

购物车在未登录时也能工作、没有后端读写成本、刷新页面不会丢失。代价是换设备不同步，且数据可被用户修改。所以后端绝不能信任购物车价格；本项目正确地只信任 product ID 和 quantity。

### 4.4 Cognito 与 PKCE

静态网页属于 public client，无法安全保存 client secret。PKCE 先生成随机 verifier，再发送其 SHA-256 challenge；授权回调换 token 时必须提交原 verifier。即使授权码被截获，没有 verifier 也不能换 token。这比 implicit flow 更符合现代 OAuth 建议。

Token 放在 `sessionStorage`，关闭标签页后消失，降低长期泄露风险；代价是用户需要更频繁登录。API Gateway 验证 issuer、audience、签名和到期时间，Lambda 再从 authorizer context 读取 claims。

## 5. DynamoDB 数据模型

### 5.1 Ecommerce 单表

表的复合主键是 `PK + SK`：

| 实体 | PK | SK | 典型字段 |
|---|---|---|---|
| 商品 | `PRODUCT` | `P001` | name, price, stock, imageUrl, category |
| 订单 | `ORDER` | `ORD-uuid` | owner, customer, items, totals, status, timestamps |

优点：只维护一张主表；通过固定 partition key 查询某类实体；产品精确读取和订单精确读取都是 GetItem。缺点：所有订单位于 `PK=ORDER`，大规模系统会形成热分区；用户订单列表使用 Query 后 FilterExpression，读了别人的订单再过滤，规模大时低效。生产级设计可使用 `USER#sub` 作为订单 PK，或增加 `owner-createdAt-index` GSI。

### 5.2 OrderIdempotency 表

主键格式：`IDEMP#<Cognito sub>#<client key>`。记录 orderId 和 24 小时后的 `expiresAt`。客户端重试同一个请求时返回同一订单，避免双击或网络重试产生重复订单。应在表上启用 TTL 指向 `expiresAt`；TTL 删除是最终一致、不会精确到秒。

### 5.3 库存事务

每件商品执行：

```text
SET stock = stock - :qty
CONDITION attribute_exists(SK) AND stock >= :qty
```

这些 Update、订单 Put 和幂等 Put 放入一个 `TransactWriteCommand`。任何一项失败，全部回滚，因此不会出现“订单写成功但只扣了部分商品”。条件表达式防止负库存和并发超卖。

当前语义是“创建订单时预留/扣减库存”，不是“支付成功才扣”。优点是用户进入 Stripe 后商品不会被别人抢走；缺点是用户放弃付款后库存不会自动恢复。生产改进方案是给 PENDING_PAYMENT 设置过期时间，通过 EventBridge Scheduler/TTL Stream 恢复库存，或者在支付成功时扣库存但处理支付成功后缺货的补偿逻辑。

## 6. API Gateway：精确设计

### 6.1 为什么是 HTTP API 而不是 REST API

HTTP API 更便宜、延迟更低，并原生支持 JWT authorizer；本项目不需要 REST API 的 usage plan、API key、request validator 或复杂 mapping template。API key 也不是用户认证机制，不能替代 Cognito。

### 6.2 Stage 与域名

- SAM 资源：`AWS::Serverless::HttpApi`。
- Stage：`prod`。
- 原始 URL：`https://<api-id>.execute-api.us-east-1.amazonaws.com/prod`。
- 自定义 URL：`https://api.ezei.shop`。
- `AWS::ApiGatewayV2::ApiMapping` 将自定义域名根路径映射到 `prod` stage。
- API 域名使用 Regional endpoint 和 TLS 1.2；API 不需要再经 CloudFront，因为 HTTP API 自身是托管区域端点，系统规模也不要求额外边缘代理。

### 6.3 JWT Authorizer 的每个部分

- `DefaultAuthorizer: CognitoJwtAuthorizer`：除非路由显式写 NONE，否则默认必须登录。
- `issuer`：Cognito User Pool 的 OIDC issuer，API Gateway 从其 discovery/JWKS 获得公钥。
- `audience`：User Pool app client ID，防止其他 app 的 token 被接受。
- `IdentitySource: $request.header.Authorization`：从 Bearer header 取 token。
- 商品 GET 和 Stripe webhook 显式 `Authorizer: NONE`。商品是公开目录；Webhook 使用 Stripe HMAC 身份而不是 Cognito 用户身份。

### 6.4 CORS 的每个部分

- `AllowOrigins` 只允许精确的 `https://ezei.shop`，而不是 `*`。
- `AllowHeaders`：authorization、content-type、idempotency-key、stripe-signature。
- `AllowMethods`：GET、POST、PATCH、OPTIONS。
- `MaxAge: 600`：浏览器可缓存 preflight 10 分钟，降低 OPTIONS 请求。

为什么不用 `*`：带 Authorization 的跨域请求需要可控 origin；开放任意站点虽不直接绕过 JWT，但扩大 token 被恶意网页使用的攻击面。Stripe webhook 不是浏览器 CORS 请求，`stripe-signature` 放在允许列表不是其安全核心。

### 6.5 路由总表

| Method | Path | Auth | Lambda | 作用 | 常见响应 |
|---|---|---|---|---|---|
| GET | `/products` | public | ProductFunction | 商品列表 | 200/500 |
| GET | `/products/{id}` | public | GetProductFunction | 商品详情 | 200/400/404 |
| POST | `/orders` | Cognito JWT | OrderFunction | 创建订单、扣库存 | 201/400/401/409 |
| GET | `/orders` | Cognito JWT | OrderFunction | 当前用户订单 | 200/401 |
| GET | `/orders/{id}` | Cognito JWT + owner check | OrderFunction | 当前用户订单详情 | 200/404 |
| POST | `/payment` | Cognito JWT + owner check | PaymentFunction | Stripe Session | 200/403/404/409/502 |
| POST | `/stripe/webhook` | Stripe signature | StripeWebhookFunction | 支付确认 | 200/400/500 |
| POST | `/orders/{id}/notifications` | JWT + owner check | NotificationFunction | 重发状态邮件 | 202/403/404 |
| GET | `/admin/orders` | JWT + Admins group | AdminOrdersFunction | 全部订单 | 200/403 |
| PATCH | `/admin/orders/{id}` | JWT + Admins group | AdminOrdersFunction | 顺序更新状态 | 200/400/403/409 |

### 6.6 日志

Access log JSON 包含 requestId、routeKey、status、responseLength 和 integrationError，保留 14 天。JSON 比自然语言日志更适合 CloudWatch Logs Insights。没有记录 Authorization、请求 body 或客户 PII，这是安全优势。

## 7. Lambda 与共享模块逐行详解

说明：空行和只负责闭合语法的括号与相邻逻辑一起解释；表中的行号对应当前仓库文件。

### 7.1 `shared/data.mjs`（1–26）

| 行 | 解释 |
|---|---|
| 1–2 | 导入底层 DynamoDB client、DocumentClient 和 GetCommand。DocumentClient 自动在 JS 值与 DynamoDB AttributeValue 间转换。 |
| 4–5 | 从环境变量读两张表名，并提供本地默认值；同一代码可部署到不同环境。 |
| 7 | 创建 SDK client；空配置会使用 Lambda region 和执行角色凭据。放在 handler 外可复用连接。 |
| 8–10 | 包装 DocumentClient；删除 undefined，避免 marshalling 报错。 |
| 12–18 | `getProduct` 用固定 PK=PRODUCT、动态 SK=productId 做强目标读取；不存在返回 null。 |
| 20–26 | `getOrder` 同理，以 PK=ORDER、SK=orderId 获取订单。 |

### 7.2 `shared/http.mjs`（1–43）

| 行 | 解释 |
|---|---|
| 1–7 | 构造 Lambda proxy response；统一 JSON content type 与序列化。CORS 由 API Gateway 管理，所以这里不重复。 |
| 9–10 | 无 body 时返回空对象，便于 GET/可选 body。 |
| 11–15 | 支持普通和 base64 body，并 JSON.parse。 |
| 16–20 | 将解析错误转换为可公开的 400，而不是 500。 |
| 23–25 | 从 HTTP API JWT authorizer context 读取 claims；注意 REST API 的 context 结构不同。 |
| 27–35 | 必须有稳定的 `sub` 用户 ID，否则抛 401；返回 claims 供 ownership/group 检查。 |
| 37–39 | 读取业务错误 statusCode；未知错误默认 500，服务端错误写 CloudWatch。 |
| 40–42 | 4xx 返回明确原因；5xx 统一隐藏为 internal error，避免泄露表名、ARN 或 Stripe 信息。 |

### 7.3 `shared/stripe.mjs`（1–54）

| 行 | 解释 |
|---|---|
| 1–2 | 导入 HMAC、常量时间比较和 Secrets Manager SDK。 |
| 4–5 | client 与缓存位于模块作用域，Lambda warm invocation 可复用，减少 Secrets Manager 调用与成本。 |
| 7–11 | `stripeSecrets` 首先命中缓存，否则按 `STRIPE_SECRET_ID` 取 secret。 |
| 12 | 同时支持 SecretString 与 SecretBinary。 |
| 13–18 | 首选 JSON 格式，并兼容两套字段命名。 |
| 19–21 | 如果不是 JSON，将整个值当 Stripe secret key；但此格式无法同时存 webhook secret。 |
| 22–24 | 没有 secret key 立即失败，避免向 Stripe 发送无效请求。 |
| 26–35 | `stripeRequest` 使用 Node 22 原生 fetch，向 Stripe v1 发 form-urlencoded POST；Basic auth 的用户名是 secret key，密码为空。 |
| 36–42 | 解析 Stripe JSON；上游拒绝映射成 502，表示本服务正常但依赖服务拒绝。 |
| 45–46 | 解析 `t=...,v1=...` 签名头。当前实现用 Object.fromEntries；若 Stripe 发送多个 v1，只保留最后一个。 |
| 47–49 | 时间戳、签名必须存在，且默认与当前时间差不超过 300 秒，防 replay。 |
| 50 | 按 Stripe 规则对 `timestamp.rawBody` 做 SHA-256 HMAC。必须用原始 body，重新 stringify 会导致失败。 |
| 51–53 | 转 Buffer、先比长度再 timingSafeEqual，避免普通字符串比较的时序侧信道。 |

### 7.4 Product Lambda（1–19）

| 行 | 解释 |
|---|---|
| 1–3 | 导入 Scan、共享 DB、响应工具。 |
| 5–6 | 导出 SAM 指向的 async handler 并进入 try。 |
| 7–13 | 扫描表但只保留 PK=PRODUCT；ProjectionExpression 限制返回字段；`name` 是保留词，所以用 `#n` 别名。 |
| 14 | 无 Items 时用空数组，并按 SK 排序保证稳定显示。 |
| 15 | 返回公开商品数组。 |
| 16–18 | 未知异常统一安全处理。 |

为什么 Scan：数据只有 9 件，代码简单。为什么不是长期最佳方案：Scan 会读取整张表后再过滤，表变大时浪费 RCU；应改成 `Query PK = PRODUCT`。

### 7.5 Get Product Lambda（1–15）

| 行 | 解释 |
|---|---|
| 1–2 | 复用精确读取和 HTTP 工具。 |
| 4–7 | 从 `{id}` path parameter 取 ID；缺失返回 400。 |
| 8 | DynamoDB GetItem。 |
| 9–11 | 存在返回 200，否则 404。 |
| 12–14 | 安全错误响应。 |

### 7.6 Order Lambda（1–152）

| 行 | 解释 |
|---|---|
| 1–5 | 导入 UUID、DynamoDB Get/Query/Transaction、SNS 和共享安全工具。 |
| 7–8 | 在 handler 外创建 SNS client 并缓存 topic ARN。 |
| 10–12 | `cleanText` 只接受字符串、trim 并截断，限制异常大输入。 |
| 14–22 | 构造规范化 customer：email 小写、省份/邮编大写并限制长度。 |
| 23–29 | 验证必填、基础 email、两位省份和加拿大邮编；失败抛 400。它不是完整地址验证，只是格式防线。 |
| 32–37 | items 必须是 1–25 行，限制事务大小和滥用。 |
| 38–49 | Map 合并重复 productId；每行数量必须 1–20；输出规范数组。注意合并后总数可能超过 20，这是当前边界缺口。 |
| 52–55 | 对客户端移除内部 PK/SK、owner 和 paymentIntentId。 |
| 57–63 | 有 path id 时读取单订单；owner 不匹配也返回 404，避免确认订单是否存在。 |
| 64–70 | 列出订单时 Query PK=ORDER，再以 owner 过滤。安全正确但规模效率有限。 |
| 71–75 | ISO 时间字符串可按字典序排序；清理内部字段后返回。 |
| 77–80 | 所有路由先要求用户；GET 分流到读取，其他方法进入创建逻辑。 |
| 81–83 | 解析 body、客户和商品行。 |
| 84–88 | 从大小写 header 或 body 读取幂等 key，最长 100；缺失 400。 |
| 90–94 | 先查幂等表；存在即返回原 orderId，不重复扣库存。状态固定返回 PENDING_PAYMENT，若原订单后来已 PAID，这个 replay 状态可能不准确。 |
| 96–104 | 并行读取可信商品；不存在 400；只从数据库复制名称、价格、图片，忽略客户端价格。 |
| 106–109 | 后端计算小计、13% HST、低于 $100 的 $10 运费和总额；toFixed 控制货币小数误差。更严格系统应用整数 cents。 |
| 110–116 | UUID 订单号、ISO 时间、订单快照和初始 PENDING_PAYMENT。订单保存商品名称/单价快照，未来改价不会改变旧订单。 |
| 118–126 | 为每件商品构造条件 Update：存在且库存足够才扣。 |
| 127–134 | 同一事务加入订单 Put 和幂等 Put，二者都要求此前不存在。 |
| 135 | 原子提交全部操作；最多 25 商品 + 2 写入，低于 DynamoDB 100 action 上限。 |
| 137–143 | 事务成功后发布 ORDER_CREATED；SNS 失败被记录但不回滚订单，这是合理的核心数据优先策略，但缺少 outbox/retry。 |
| 144 | 返回 201、订单 ID 和可信总价。 |
| 145–149 | 事务冲突统一映射 409，可能是缺货、并发或重复。 |
| 150–152 | 交给安全错误包装并结束。 |

### 7.7 Payment Lambda（1–40）

| 行 | 解释 |
|---|---|
| 1–3 | 读取可信订单、验证用户并调用 Stripe helper。 |
| 5–10 | 向 URLSearchParams 加 Stripe line item；金额乘 100 并 round 为 cents。 |
| 12–16 | 要求 JWT、解析 orderId、缺失 400。 |
| 17–20 | 订单必须存在、属于当前 sub、且不能已经 PAID。当前没有明确限制仅 PENDING_PAYMENT 可支付，PROCESSING 等状态理论上也可能进入。 |
| 22–29 | 创建 payment 模式，写 client reference、客户 email、成功/取消 URL 和 metadata；metadata 用于 webhook 关联。 |
| 30–33 | 商品、HST、运费均变成 Stripe line item，因此 Checkout 显示金额可解释。 |
| 35–36 | 服务端创建 Session，只把 session ID 和 hosted URL 返回浏览器。 |
| 37–39 | 统一错误。 |

为什么用 Stripe Checkout 而不是自己收卡号：卡数据直接进入 Stripe，项目服务器不处理 PAN/CVC，显著降低 PCI 范围与安全风险；代价是 UI 定制较少且依赖外部服务。

### 7.8 Stripe Webhook Lambda（1–52）

| 行 | 解释 |
|---|---|
| 1–5 | 导入订单更新、SNS、共享 DB/HTTP/Stripe 验签。 |
| 7 | warm-reuse SNS client。 |
| 9–14 | 获取未经修改的 raw body 和大小写签名头；base64 情况先解码。 |
| 15–18 | 从 Secrets Manager 获得 webhook secret；HMAC 不通过返回 400。公开路由安全性完全依赖这里。 |
| 20–21 | 解析事件；非 checkout.session.completed 返回 200，避免 Stripe 重试无关事件。 |
| 22–25 | 只处理 payment_status=paid，并从 metadata/reference 得到 order ID。 |
| 27–38 | 条件更新存在的订单，把状态、session、payment intent、paidAt/updatedAt 写入并返回新记录。 |
| 40–47 | 发布 ORDER_PAID，邮件消费者随后读取订单。 |
| 48 | 返回 200 告诉 Stripe 已接收。 |
| 49–51 | 异常统一处理；500 会促使 Stripe 重试。 |

已知问题：条件允许状态已经是 PAID，因此 Stripe 重试会再次成功并再次发 SNS/邮件。应改为只允许 PENDING_PAYMENT，捕获 ConditionalCheckFailed 后读取订单；若已 PAID 则返回 200 但不发事件。还应记录 Stripe `event.id` 做事件级幂等。

### 7.9 Notification Lambda（1–23）

| 行 | 解释 |
|---|---|
| 1–3 | 导入 SNS、订单读取和认证。 |
| 5 | 复用 SNS client。 |
| 7–13 | 要求 JWT，从 path 读订单，验证存在与 owner。 |
| 14–18 | 发布 ORDER_STATUS 消息，携带当前状态和摘要。 |
| 19 | 202 表示“已排队”，不代表邮件已送达。 |
| 20–22 | 安全错误。 |

这条路由用于重发/触发通知。为什么不直接调 SES：SNS 将 API 响应与邮件速度/失败解耦，也让以后增加 SMS、审计消费者更容易。

### 7.10 Order Notification Lambda（1–71）

| 行 | 解释 |
|---|---|
| 1–4 | 导入 SES、订单读取并创建 client。 |
| 5–7 | 用加拿大 locale 和订单 currency 格式化金额。 |
| 9–13 | escapeHtml 转义客户、商品等动态值，防止注入邮件 HTML。 |
| 15–24 | 根据消息类型/状态选择标题和文案；PAID 与三个履约状态有不同内容。 |
| 25–26 | 生成主题和订单详情链接。当前源码中破折号有编码显示异常，应改成普通 `—`。 |
| 27–30 | 把每个订单项变为 table row，并转义名称。 |
| 31–42 | 构造 table-based inline CSS HTML；邮件客户端对现代 CSS 支持不一致，所以 table + inline style 比 Bootstrap 更可靠。 |
| 43–45 | 同时生成纯文本 fallback，提升可访问性和反垃圾邮件兼容。 |
| 46–47 | 返回三部分邮件内容。 |
| 49–53 | Lambda 接受 SNS batch，逐条 parse；没有 orderId 或 sender 时跳过。 |
| 54–56 | 重新读完整订单，以数据库为真；无收件人跳过。 |
| 57–67 | SES SendEmail，指定 UTF-8 HTML + text，From 必须是已验证地址且 IAM 有条件限制。 |
| 68–70 | 计数并返回，主要用于日志/测试。 |

### 7.11 Admin Orders Lambda（1–31）

| 行 | 解释 |
|---|---|
| 1–5 | 导入 DynamoDB/SNS/HTTP 并复用 client。 |
| 6 | 明确有限状态机：PAID→PROCESSING→SHIPPED→DELIVERED；不能跳步或倒退。 |
| 7–11 | 先要求 JWT，再兼容 array/string 格式解析 `cognito:groups`；非 Admins 返回 403。 |
| 12 | 移除内部字段。 |
| 13–16 | Query 所有 ORDER、排序并返回。没有分页，订单很多时会漏掉 1 MB 之后的数据。 |
| 17–20 | 读取 ID 和目标状态；目标必须是状态机的 next value；反查 previous 状态并生成时间。 |
| 21–23 | 条件更新要求数据库当前状态正好等于 previous，防并发管理员覆盖。 |
| 24–27 | 发布状态事件并返回公开订单。 |
| 29–30 | 根据 HTTP method 分派 GET/PATCH，其他 405。 |
| 31 | 条件冲突映射 409，提示刷新；其他异常安全包装。 |

API Gateway 只验证“这是合法 Cognito 用户”，管理员授权在 Lambda 中检查 group。这很直观，但更高级方案可用自定义 authorizer/scopes；本项目的方式足够清晰且成本低。

## 8. 订单状态机

```text
PENDING_PAYMENT --Stripe signed webhook--> PAID
PAID --admin--> PROCESSING --admin--> SHIPPED --admin--> DELIVERED
```

前端成功页不能将订单设为 PAID，因为用户可以伪造 URL。只有 Stripe 服务器发送、且通过 HMAC 的 webhook 有权确认支付。管理员每次转换都使用 DynamoDB condition，避免两个管理员页面同时更新造成丢失写。

## 9. SNS 与 SES 事件驱动通知

SNS topic 是订单事件总线。Order、Webhook、Admin、Notification Lambda 都只 publish；OrderNotification Lambda subscribe。好处是发送邮件失败不拖慢支付 webhook，也不让业务 Lambda获得 SES 权限。SES 权限通过 `ses:FromAddress` 限制只能用指定 From 地址。

在 SES sandbox 中，发件人与收件人通常都要验证；转出 sandbox 后只要求身份/域名按 SES 规则验证。邮件“接受”不等于最终投递，生产系统还应处理 bounce/complaint、DKIM、SPF、DMARC 和 suppression list。

## 10. S3、CloudFront、Route 53、ACM

### 10.1 私有 S3 + OAC

S3 bucket 不是公开网站 endpoint。CloudFront OAC 使用 SigV4 获取对象，bucket policy 仅允许该 distribution。这样用户只能通过 HTTPS、自定义域和 CloudFront response headers 访问。之前商品图片使用 S3 直链会 403；当前 DynamoDB URL 已改为 `https://ezei.shop/...`，前端也兼容旧订单 URL。

### 10.2 CloudFront 设置理由

- HTTP/2 + HTTP/3、IPv6：现代传输。
- PriceClass_100：只用较低成本边缘区域，适合加拿大课堂展示；全球性能不是首要目标。
- ViewerProtocolPolicy redirect-to-https：HTTP 自动转 HTTPS。
- TLSv1.2_2021 + SNI：现代最低 TLS，避免专用 IP 成本。
- managed cache policy：减少自定义错误。
- managed security headers policy：统一浏览器安全响应头。
- CloudFront Function：在 viewer-request 将 `www` 301 到 apex；比 Lambda@Edge 更轻、更便宜。
- 没有 WAF：明确的成本选择。

### 10.3 DNS 与证书

根域和 www 都有 A/AAAA Alias 指向 CloudFront；Alias 不像 CNAME 那样禁止用于 zone apex。`api` A/AAAA Alias 指向 API Gateway Regional domain。CloudFront 证书必须在 us-east-1；Regional API 的证书位于 API 所在 region（本项目也是 us-east-1）。DNS validation 可自动续期，前提是验证记录保留。

## 11. IAM 与最小权限

每个 SAM Lambda 有独立执行角色和策略：商品只读；订单读写两表并 publish；支付只读订单和读 Stripe secret；Webhook 只写订单、读 secret、publish；邮件只读订单并受条件限制地 SendEmail。这比一个共享 AdministratorAccess 角色安全得多。

GitHub Actions 使用 OIDC，不保存长期 AWS access key。GitHub token 的 `sub` 被限制为指定 repo/main/environment；OIDC role 可以发起 CloudFormation，CloudFormation 再 assume execution role。两角色分离让 CI 不直接拥有所有资源权限。

当前已知 CI ticket：`bmazon-cloudformation-execution` 缺少对 SAM transform ARN 的 `cloudformation:CreateChangeSet`，导致 deployment run 28747806998 失败；Node 20 annotation 只是 warning。修复应同时更新实际 IAM policy 和 IaC，并升级 action major versions。本文不声称 CI 当前为绿色。

## 12. SAM、CloudFormation 与 Terraform

`infra/template.yaml` 是当前后端 SAM 定义；`domain-template.yaml` 定义 CDN/域名；`github-oidc-template.yaml` 定义 CI 身份。SAM 会把 `AWS::Serverless::*` transform 成普通 CloudFormation 资源。

`terraform/` 是同一架构的 Terraform 表达，用于展示 IaC 能力，已执行 fmt/validate，但当前生产资源由 CloudFormation 所有，未执行 Terraform apply。不能对同一批资源直接 apply 两套 IaC，否则会出现状态所有权冲突、重复资源或删除风险。迁移需要逐项 `terraform import`、核对 plan 为 no-op，再决定切换所有权。

## 13. CI/CD

CI 在 PR/main 上执行 Node test、SAM lint/build、Terraform fmt/init/validate。Deploy 在 main push 或手工触发，使用 OIDC 临时凭据，依次部署 backend、domain、sync frontend、CloudFront invalidation。`concurrency: production` 防止两次生产部署并发。

为什么先 test/build：尽早失败。为什么 backend 先于 frontend：避免前端先引用尚不存在的新 API。为什么 invalidation：HTML 和 JS 更新应尽快生效；代价是全路径 invalidation 比版本化静态资产更粗。生产优化是给 assets 加 content hash 和长期 cache，只对 HTML invalidation。

## 14. 测试策略

Node 内置 test runner 避免 Jest 依赖；目前覆盖购物车行为、HTTP parse/auth/error、生产域名、SAM 路由/CORS、库存事务源码约束、实时库存 UI 和旧署名清除。优点是快且零依赖；局限是多数是 unit/source assertion，没有在临时 AWS 环境运行真实 API/Stripe/SES integration test。

建议的下一层测试：

1. Order handler 使用 mock DynamoDB，验证价格不能由前端篡改。
2. 同时提交两个最后库存订单，验证一个 201、一个 409。
3. Webhook 相同 event 两次，只发一次 SNS。
4. Admin 跳过状态返回 409。
5. Playwright 模拟登录后购物车/checkout，但 Stripe 使用 test fixture。

## 15. 安全威胁与防护

| 威胁 | 当前防护 | 剩余风险/改进 |
|---|---|---|
| 篡改价格 | 后端重读 DynamoDB | 用整数 cents 进一步减少浮点误差 |
| 未登录调用 | API Gateway JWT | 商品端点有意公开 |
| 越权看订单 | owner 与 `sub` 比较 | 管理员页面链接订单详情时，普通 order endpoint owner check 可能阻止管理员查看他人详情 |
| 伪造支付 | Stripe HMAC + 5 分钟容差 | 增加 event.id 幂等 |
| 超卖 | DynamoDB transaction + condition | 放弃支付库存不回补 |
| XSS | 多处 escapeHtml | `shop.html` 商品模板当前直接插值，应统一转义/DOM textContent |
| Secret 泄露 | Secrets Manager + IAM | secret rotation 尚未自动化 |
| S3 绕过 | private bucket + OAC | 保持 Block Public Access |
| 滥用流量 | 无 WAF（成本选择） | 可用 API throttling/budgets；演示结束可停用资源 |
| 重复请求 | order idempotency | Stripe webhook 幂等仍需加强 |

## 16. 成本模型

低流量时 Lambda、API Gateway、DynamoDB、S3、CloudFront、SNS、SES 多数按使用量计费，通常很低。更稳定的固定/最低成本来源包括域名注册、Route 53 hosted zone、Secrets Manager secret；CloudWatch 日志和 CloudFront 流量随使用增长。Stripe 只对真实交易按其账户/地区规则收费，测试模式不产生真实扣款。

成本控制设置：arm64 Lambda 256 MB/10 秒；CloudFront PriceClass_100；日志 14 天；DynamoDB 按需；没有 NAT Gateway、EC2、RDS、WAF、OpenSearch 或 Kubernetes。建议开启 AWS Budget 告警，并在课程结束后决定是否删除自定义域、secret 和闲置日志。

## 17. 已知限制与诚实的改进路线

优先级 P0：修复 CI execution role 的 SAM transform 权限；让部署重新绿色。

优先级 P1：Webhook event 幂等；未支付订单库存过期回补；Query 替代产品 Scan；用户订单 GSI/更好主键；所有列表分页。

优先级 P2：统一前端 HTML 转义；修复源码编码异常；订单金额改整数 cents；Payment 仅允许 PENDING_PAYMENT；管理员拥有专用订单详情 endpoint；SNS→Lambda 增加 DLQ；CloudWatch alarm 增加通知 action。

优先级 P3：Stripe refund/cancel、库存补偿、SES bounce/complaint、结构化业务日志、X-Ray trace 分析、端到端测试、多环境 dev/prod 参数化。

## 18. 答辩时应能回答的问题

1. 为什么不能相信前端价格？——浏览器可被修改，必须后端读商品并计算。
2. 为什么成功页不能确认付款？——URL 可伪造，只有 Stripe 签名 webhook 是可信服务器事件。
3. 如何防超卖？——DynamoDB 条件更新放在原子 transaction。
4. 如何防重复订单？——用户 sub + idempotency key 的独立表和条件 Put。
5. 为什么 webhook 不用 Cognito？——调用者是 Stripe，不是用户；使用共享 webhook secret 的 HMAC。
6. 为什么 SNS？——把业务状态提交和邮件发送解耦，缩短 API/webhook 路径并最小化 SES 权限。
7. 为什么 S3 仍然私有？——CloudFront OAC 读取，避免绕过 HTTPS/headers/domain。
8. 为什么不用 WAF？——学校低流量项目的成本取舍，现有身份、签名、输入校验覆盖核心目标。
9. SAM 与 Terraform 是否同时管理生产？——不是；CloudFormation 当前拥有，Terraform 是验证过的替代表达，apply 前必须 import/migrate。
10. 系统最大技术债是什么？——库存 reservation 无过期回补、webhook 幂等、DynamoDB access pattern 和当前 CI IAM ticket。

## 19. 从零复述一次完整购买

用户打开 CloudFront 页面，商品 API 公开读取 DynamoDB。登录时 Cognito 通过 PKCE 给浏览器 JWT。Checkout 带 JWT 和 idempotency key 调 POST /orders。API Gateway 验 token，Order Lambda 用 sub 标记 owner，从 DynamoDB 重读每件商品，在一个 transaction 中条件扣库存、保存 PENDING_PAYMENT 订单和幂等记录。随后前端只提交 orderId 到 Payment Lambda；它检查 owner、读取可信订单、从 Secrets Manager 取 Stripe key并创建 hosted Session。用户在 Stripe 输入卡信息。Stripe 服务器调用公开 webhook；Lambda 对 raw body 做 HMAC，确认 paid 后把订单改为 PAID并发布 SNS。邮件 Lambda读取完整订单，用 SES 发送 HTML/text 确认信。管理员 JWT 中有 Admins group，可按状态机逐步 PATCH；每次条件更新后再次通过 SNS/SES 发邮件。

如果你能不看文档完整讲出上一段，并能解释每一个“不直接”的原因——不直接信价格、不直接收卡、不直接从成功页确认、不直接在业务 Lambda 发邮件、不公开 S3——你就已经真正掌握了这个项目的核心。
