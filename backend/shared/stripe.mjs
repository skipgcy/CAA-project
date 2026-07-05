import { createHmac, timingSafeEqual } from "node:crypto";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const secrets = new SecretsManagerClient({});
let cached;

export async function stripeSecrets() {
    if (cached) return cached;
    const result = await secrets.send(new GetSecretValueCommand({
        SecretId: process.env.STRIPE_SECRET_ID
    }));
    const raw = result.SecretString || Buffer.from(result.SecretBinary || "", "base64").toString("utf8");
    try {
        const parsed = JSON.parse(raw);
        cached = {
            secretKey: parsed.STRIPE_SECRET_KEY || parsed.secretKey,
            webhookSecret: parsed.STRIPE_WEBHOOK_SECRET || parsed.webhookSecret
        };
    } catch {
        cached = { secretKey: raw };
    }
    if (!cached.secretKey) throw new Error("Stripe secret key is not configured.");
    return cached;
}

export async function stripeRequest(path, params) {
    const { secretKey } = await stripeSecrets();
    const response = await fetch(`https://api.stripe.com/v1${path}`, {
        method: "POST",
        headers: {
            authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
            "content-type": "application/x-www-form-urlencoded"
        },
        body: params
    });
    const body = await response.json();
    if (!response.ok) {
        const error = new Error(body?.error?.message || "Stripe rejected the request.");
        error.statusCode = 502;
        throw error;
    }
    return body;
}

export function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
    const values = Object.fromEntries(String(signatureHeader || "").split(",").map((part) => part.split("=", 2)));
    const timestamp = Number(values.t);
    const signature = values.v1;
    if (!timestamp || !signature || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;
    const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    const left = Buffer.from(expected, "hex");
    const right = Buffer.from(signature, "hex");
    return left.length === right.length && timingSafeEqual(left, right);
}
