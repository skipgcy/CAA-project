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
