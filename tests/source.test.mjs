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

test("HTML pages contain no former team attribution or legacy API IDs", async () => {
    const files = (await readdir(".")).filter((name) => name.endsWith(".html"));
    const contents = await Promise.all(files.map((name) => readFile(name, "utf8")));
    const combined = contents.join("\n");
    assert.doesNotMatch(combined, /and Shahab/);
    assert.doesNotMatch(combined, /gm7tjln2c4|eath06x9v8/);
});
