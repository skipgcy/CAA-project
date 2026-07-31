import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

test("production configuration uses custom HTTPS domains", async () => {
    const config = await readFile("assets/js/config.js", "utf8");
    assert.match(config, /https:\/\/api\.ezei\.shop/);
    assert.match(config, /https:\/\/ezei\.shop\/checkout\.html/);
    assert.doesNotMatch(config, /execute-api|s3\.us-east-1\.amazonaws\.com/);
});

test("SAM template protects APIs and supports PATCH CORS", async () => {
    const template = await readFile("infra/template.yaml", "utf8");
    assert.match(template, /DefaultAuthorizer: CognitoJwtAuthorizer/);
    assert.match(template, /AllowMethods: \[GET, POST, PATCH, DELETE, OPTIONS\]/);
    assert.match(template, /Path: \/admin\/orders/);
    assert.match(template, /Path: \/admin\/products/);
    assert.match(template, /Path: \/admin\/products\/images/);
    assert.match(template, /s3:PutObject/);
});

test("order creation atomically decrements inventory and prevents overselling", async () => {
    const source = await readFile("backend/functions/order/index.mjs", "utf8");
    assert.match(source, /TransactWriteCommand/);
    assert.match(source, /SET stock = stock - :qty/);
    assert.match(source, /stock >= :qty/);
    assert.match(source, /isActive = :active/);
    assert.match(source, /TransactionCanceledException/);
});

test("admin product management is admins-only and supports soft deletion", async () => {
    const source = await readFile("backend/functions/admin-products/index.mjs", "utf8");
    assert.match(source, /cognito:groups/);
    assert.match(source, /Admins/);
    assert.match(source, /method === "POST"/);
    assert.match(source, /method === "PATCH"/);
    assert.match(source, /method === "DELETE"/);
    assert.match(source, /SET isActive = :inactive/);
    assert.match(source, /PutObjectCommand/);
    assert.match(source, /assets\/img\/products/);
    assert.match(source, /Only JPG, PNG, WEBP, and GIF/);
    assert.match(source, /function cleanProductKey/);
    assert.match(source, /cleanProductKey\(event\?\.pathParameters\?\.id\)/);
});

test("admin UI supports local product image uploads", async () => {
    const admin = await readFile("admin.html", "utf8");
    const source = await readFile("assets/js/admin-products.js", "utf8");
    assert.match(admin, /productThumbnailFile/);
    assert.match(admin, /productDetailFiles/);
    assert.match(source, /FileReader/);
    assert.match(source, /\/admin\/products\/images/);
});

test("storefront displays live stock and disables sold-out purchases", async () => {
    const shop = await readFile("shop.html", "utf8");
    const detail = await readFile("shop-product-detail.html", "utf8");
    assert.match(shop, /cache: "no-store"/);
    assert.match(shop, /Sold out/);
    assert.match(detail, /addCartBtn.*disabled = soldOut/);
    assert.match(detail, /buyBtn.*disabled = soldOut/);
});

test("product detail normalizes restored DynamoDB keys before adding to cart", async () => {
    const detail = await readFile("shop-product-detail.html", "utf8");
    assert.match(detail, /product\.productId\s*=\s*product\.productId\s*\|\|\s*product\.id\s*\|\|\s*product\.SK\s*\|\|\s*id/);
    assert.match(detail, /BmazonCart\.add\(product, quantity\)/);
});

test("checkout restores the customer name after an OAuth round trip", async () => {
    const checkout = await readFile("assets/js/checkout.js", "utf8");
    assert.match(checkout, /name:\s*"customerName"/);
    assert.match(checkout, /formField\[name\]\s*\|\|\s*name/);
});

test("storefront search supports keyword, product name, and product ID", async () => {
    const shop = await readFile("shop.html", "utf8");
    const index = await readFile("index.html", "utf8");
    assert.match(shop, /productSearchInput/);
    assert.match(shop, /function searchableText/);
    assert.match(shop, /productId\(p\)/);
    assert.match(shop, /URLSearchParams\(window\.location\.search\)/);
    assert.match(shop, /matchesQuery\(p, currentQuery\)/);
    assert.match(index, /action="shop\.html"/);
    assert.match(index, /shop\.html\?q=/);
});

test("HTML pages contain no former team attribution or legacy API IDs", async () => {
    const files = (await readdir(".")).filter((name) => name.endsWith(".html"));
    const contents = await Promise.all(files.map((name) => readFile(name, "utf8")));
    const combined = contents.join("\n");
    assert.doesNotMatch(combined, /Designed by .+ and .+/);
    assert.doesNotMatch(combined, /Group 2|Copyright &copy;/);
    assert.doesNotMatch(combined, /gm7tjln2c4|eath06x9v8/);
});

test("CI and deployment workflows enforce Trivy and SonarQube before release", async () => {
    const ci = await readFile(".github/workflows/ci.yml", "utf8");
    const deploy = await readFile(".github/workflows/deploy.yml", "utf8");
    for (const workflow of [ci, deploy]) {
        assert.match(workflow, /aquasecurity\/trivy-action@v0\.36\.0/);
        assert.match(workflow, /scanners: vuln,secret,misconfig/);
        assert.match(workflow, /severity: HIGH,CRITICAL/);
        assert.match(workflow, /exit-code: 1/);
        assert.match(workflow, /trivyignores: \.trivyignore\.yaml/);
        assert.match(workflow, /TRIVY_SHOW_SUPPRESSED: true/);
        assert.match(workflow, /SonarSource\/sonarqube-scan-action@v8\.1\.0/);
        assert.match(workflow, /start-sonarqube\.sh/);
    }
    assert.ok(deploy.indexOf("trivy-action") < deploy.indexOf("configure-aws-credentials"));
    assert.ok(deploy.indexOf("sonarqube-scan-action") < deploy.indexOf("configure-aws-credentials"));
    assert.match(deploy, /needs: security-and-quality/);

    const properties = await readFile("sonar-project.properties", "utf8");
    assert.match(properties, /sonar\.qualitygate\.wait=true/);
    assert.match(properties, /sonar\.qualitygate\.timeout=300/);

    const trivyIgnore = await readFile(".trivyignore.yaml", "utf8");
    assert.match(trivyIgnore, /AWS-0011/);
    assert.match(trivyIgnore, /AWS-0132/);
    assert.match(trivyIgnore, /AWS-0136/);
    assert.equal((trivyIgnore.match(/expired_at: "2026-12-31T23:59:59Z"/g) || []).length, 3);
    assert.doesNotMatch(trivyIgnore, /AWS-0095/);
});

test("production and DR notification topics use AWS-managed SNS encryption", async () => {
    const production = await readFile("terraform/stateful.tf", "utf8");
    const dr = await readFile("terraform-dr/application/stateful.tf", "utf8");
    for (const stateful of [production, dr]) {
        assert.match(stateful, /resource "aws_sns_topic" "orders"/);
        assert.match(stateful, /kms_master_key_id\s*=\s*"alias\/aws\/sns"/);
    }
});

test("production and DR website buckets explicitly enable versioning and SSE-S3", async () => {
    const production = await readFile("terraform/stateful.tf", "utf8");
    const dr = await readFile("terraform-dr/application/stateful.tf", "utf8");
    for (const stateful of [production, dr]) {
        assert.match(stateful, /resource "aws_s3_bucket_versioning" "website"/);
        assert.match(stateful, /resource "aws_s3_bucket_server_side_encryption_configuration" "website"/);
        assert.match(stateful, /sse_algorithm\s*=\s*"AES256"/);
        assert.match(stateful, /resource "aws_s3_bucket_public_access_block" "website"/);
    }
});

test("DR infrastructure is isolated and has explicit destruction safeguards", async () => {
    const variables = await readFile("terraform-dr/application/variables.tf", "utf8");
    const stateful = await readFile("terraform-dr/application/stateful.tf", "utf8");
    const bootstrap = await readFile("terraform-dr/bootstrap/variables.tf", "utf8");
    const destroy = await readFile("terraform-dr/scripts/destroy-dr.ps1", "utf8");
    assert.match(variables, /var\.dr_region == "us-east-2"/);
    assert.match(variables, /var\.dr_domain_name == "dr\.ezei\.shop"/);
    assert.match(variables, /var\.restored_table_name == "Ecommerce-DR"/);
    assert.match(stateful, /data "aws_dynamodb_table" "ecommerce"/);
    assert.doesNotMatch(stateful, /resource "aws_dynamodb_table" "ecommerce"/);
    assert.match(bootstrap, /arn:aws:dynamodb:us-east-1:563960656220:table\/Ecommerce/);
    assert.match(destroy, /DESTROY-BMAZON-DR-US-EAST-2/);
    assert.match(destroy, /audit-cleanup\.ps1/);
});
