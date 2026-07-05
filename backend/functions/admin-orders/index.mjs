import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { db, TABLE_NAME } from "../../shared/data.mjs";
import { errorResponse, parseBody, requireUser, response } from "../../shared/http.mjs";
const sns = new SNSClient({});
const transitions = { PAID: "PROCESSING", PROCESSING: "SHIPPED", SHIPPED: "DELIVERED" };
function requireAdmin(event) {
    const claims = requireUser(event); const raw = claims["cognito:groups"];
    const groups = Array.isArray(raw) ? raw : String(raw || "").replace(/^\[|\]$/g, "").split(",").map((v) => v.trim());
    if (!groups.includes("Admins")) { const error = new Error("Administrator access is required."); error.statusCode = 403; throw error; }
}
function publicOrder(order) { const { PK, SK, owner, paymentIntentId, ...safe } = order; return safe; }
async function listOrders() {
    const result = await db.send(new QueryCommand({ TableName: TABLE_NAME, KeyConditionExpression: "PK = :order", ExpressionAttributeValues: { ":order": "ORDER" } }));
    return response(200, { orders: (result.Items || []).filter((order) => order.orderId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(publicOrder) });
}
async function updateStatus(event) {
    const orderId = String(event?.pathParameters?.id || "").trim(); const requestedStatus = String(parseBody(event).status || "").toUpperCase();
    if (!orderId || !Object.values(transitions).includes(requestedStatus)) return response(400, { message: "A valid order ID and status are required." });
    const previousStatus = Object.entries(transitions).find(([, next]) => next === requestedStatus)?.[0]; const now = new Date().toISOString();
    const result = await db.send(new UpdateCommand({ TableName: TABLE_NAME, Key: { PK: "ORDER", SK: orderId },
        UpdateExpression: "SET #status = :next, updatedAt = :now", ConditionExpression: "attribute_exists(SK) AND #status = :previous",
        ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":next": requestedStatus, ":previous": previousStatus, ":now": now }, ReturnValues: "ALL_NEW" }));
    const order = result.Attributes;
    await sns.send(new PublishCommand({ TopicArn: process.env.ORDER_TOPIC_ARN, Subject: `Bmazon order ${requestedStatus.toLowerCase()}`,
        Message: JSON.stringify({ type: "ORDER_STATUS", orderId, status: requestedStatus }) }));
    return response(200, { order: publicOrder(order) });
}
export const handler = async (event) => { try { requireAdmin(event); const method = event?.requestContext?.http?.method;
    if (method === "GET") return await listOrders(); if (method === "PATCH") return await updateStatus(event); return response(405, { message: "Method not allowed." });
} catch (error) { if (error?.name === "ConditionalCheckFailedException") { error.statusCode = 409; error.message = "This status transition is no longer valid. Refresh the order list."; } return errorResponse(error); } };
