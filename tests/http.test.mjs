import test from "node:test";
import assert from "node:assert/strict";
import { errorResponse, parseBody, requireUser, response } from "../backend/shared/http.mjs";

test("response serializes JSON consistently", () => {
    assert.deepEqual(response(201, { ok: true }), {
        statusCode: 201,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: '{"ok":true}'
    });
});

test("parseBody accepts plain and base64 JSON", () => {
    assert.deepEqual(parseBody({ body: '{"value":3}' }), { value: 3 });
    assert.deepEqual(parseBody({ body: Buffer.from('{"value":4}').toString("base64"), isBase64Encoded: true }), { value: 4 });
});

test("parseBody rejects malformed JSON", () => {
    assert.throws(() => parseBody({ body: "{" }), (error) => error.statusCode === 400);
});

test("requireUser returns JWT claims and rejects anonymous requests", () => {
    const claims = { sub: "user-1", email: "person@example.com" };
    assert.equal(requireUser({ requestContext: { authorizer: { jwt: { claims } } } }), claims);
    assert.throws(() => requireUser({}), (error) => error.statusCode === 401);
});

test("errorResponse hides internal errors", () => {
    const originalError = console.error;
    console.error = () => {};
    try {
        assert.equal(JSON.parse(errorResponse(new Error("database secret")).body).message, "An internal service error occurred.");
    } finally {
        console.error = originalError;
    }
    const clientError = new Error("Invalid request"); clientError.statusCode = 400;
    assert.equal(JSON.parse(errorResponse(clientError).body).message, "Invalid request");
});
