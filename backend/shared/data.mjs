import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

export const TABLE_NAME = process.env.TABLE_NAME || "Ecommerce";
export const IDEMPOTENCY_TABLE = process.env.IDEMPOTENCY_TABLE || "OrderIdempotency";

const client = new DynamoDBClient({});
export const db = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true }
});

export async function getProduct(productId) {
    const result = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: "PRODUCT", SK: productId }
    }));
    return result.Item || null;
}

export async function getOrder(orderId) {
    const result = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: "ORDER", SK: orderId }
    }));
    return result.Item || null;
}
