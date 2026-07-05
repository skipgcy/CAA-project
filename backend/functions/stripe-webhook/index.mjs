import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { db, TABLE_NAME } from "../../shared/data.mjs";
import { errorResponse, response } from "../../shared/http.mjs";
import { stripeSecrets, verifyStripeSignature } from "../../shared/stripe.mjs";

const sns = new SNSClient({});

export const handler = async (event) => {
    try {
        const rawBody = event.isBase64Encoded
            ? Buffer.from(event.body || "", "base64").toString("utf8")
            : event.body || "";
        const signature = event?.headers?.["stripe-signature"] || event?.headers?.["Stripe-Signature"];
        const { webhookSecret } = await stripeSecrets();
        if (!webhookSecret || !verifyStripeSignature(rawBody, signature, webhookSecret)) {
            return response(400, { message: "Invalid Stripe signature." });
        }

        const stripeEvent = JSON.parse(rawBody);
        if (stripeEvent.type !== "checkout.session.completed") return response(200, { received: true });
        const session = stripeEvent.data.object;
        if (session.payment_status !== "paid") return response(200, { received: true });
        const orderId = session.metadata?.order_id || session.client_reference_id;
        if (!orderId) return response(400, { message: "Stripe session has no order reference." });

        const result = await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: "ORDER", SK: orderId },
            UpdateExpression: "SET #status = :paid, paymentSessionId = :session, paymentIntentId = :intent, paidAt = :now, updatedAt = :now",
            ConditionExpression: "attribute_exists(SK) AND (#status = :pending OR #status = :paid)",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
                ":paid": "PAID", ":pending": "PENDING_PAYMENT", ":session": session.id,
                ":intent": session.payment_intent, ":now": new Date().toISOString()
            },
            ReturnValues: "ALL_NEW"
        }));

        await sns.send(new PublishCommand({
            TopicArn: process.env.ORDER_TOPIC_ARN,
            Subject: "Bmazon payment received",
            Message: JSON.stringify({
                type: "ORDER_PAID", orderId, email: result.Attributes.customer.email,
                total: result.Attributes.total, currency: result.Attributes.currency
            })
        }));
        return response(200, { received: true });
    } catch (error) {
        return errorResponse(error);
    }
};
