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
    assert.match(template, /AllowMethods: \[GET, POST, PATCH, OPTIONS\]/);
    assert.match(template, /Path: \/admin\/orders/);
});

test("order creation atomically decrements inventory and prevents overselling", async () => {
    const source = await readFile("backend/functions/order/index.mjs", "utf8");
    assert.match(source, /TransactWriteCommand/);
    assert.match(source, /SET stock = stock - :qty/);
    assert.match(source, /stock >= :qty/);
    assert.match(source, /TransactionCanceledException/);
});

test("storefront displays live stock and disables sold-out purchases", async () => {
    const shop = await readFile("shop.html", "utf8");
    const detail = await readFile("shop-product-detail.html", "utf8");
    assert.match(shop, /cache: "no-store"/);
    assert.match(shop, /Sold out/);
    assert.match(detail, /addCartBtn.*disabled = soldOut/);
    assert.match(detail, /buyBtn.*disabled = soldOut/);
});

test("HTML pages contain no former team attribution or legacy API IDs", async () => {
    const files = (await readdir(".")).filter((name) => name.endsWith(".html"));
    const contents = await Promise.all(files.map((name) => readFile(name, "utf8")));
    const combined = contents.join("\n");
    assert.doesNotMatch(combined, /and Shahab/);
    assert.doesNotMatch(combined, /Group 2|Copyright &copy;/);
    assert.doesNotMatch(combined, /gm7tjln2c4|eath06x9v8/);
});
