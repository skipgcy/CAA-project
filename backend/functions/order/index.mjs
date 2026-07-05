import { randomUUID } from "node:crypto";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { db, getOrder, getProduct, IDEMPOTENCY_TABLE, TABLE_NAME } from "../../shared/data.mjs";
import { errorResponse, parseBody, requireUser, response } from "../../shared/http.mjs";

const sns = new SNSClient({});
const TOPIC_ARN = process.env.ORDER_TOPIC_ARN;

function cleanText(value, maxLength) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validateCustomer(input = {}) {
    const customer = {
        name: cleanText(input.name, 100),
        email: cleanText(input.email, 254).toLowerCase(),
        address: cleanText(input.address, 200),
        city: cleanText(input.city, 80),
        province: cleanText(input.province, 2).toUpperCase(),
        postalCode: cleanText(input.postalCode, 7).toUpperCase()
    };
    if (!customer.name || !/^\S+@\S+\.\S+$/.test(customer.email) || !customer.address || !customer.city ||
        !/^[A-Z]{2}$/.test(customer.province) || !/^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/.test(customer.postalCode)) {
        const error = new Error("Complete and valid shipping information is required.");
        error.statusCode = 400;
        throw error;
    }
    return customer;
}

function normalizeItems(items) {
    if (!Array.isArray(items) || !items.length || items.length > 25) {
        const error = new Error("An order must contain between 1 and 25 products.");
        error.statusCode = 400;
        throw error;
    }
    const merged = new Map();
    for (const item of items) {
        const productId = cleanText(item?.productId, 40);
        const quantity = Number.parseInt(item?.quantity, 10);
        if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
            const error = new Error("Each order item must have a valid product and quantity.");
            error.statusCode = 400;
            throw error;
        }
        merged.set(productId, (merged.get(productId) || 0) + quantity);
    }
    return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}

function publicOrder(order) {
    const { PK, SK, owner, paymentIntentId, ...safe } = order;
    return safe;
}

async function readOrders(event, claims) {
    const orderId = cleanText(event?.pathParameters?.id, 80);
    if (orderId) {
        const order = await getOrder(orderId);
        if (!order || order.owner !== claims.sub) return response(404, { message: "Order not found." });
        return response(200, { order: publicOrder(order) });
    }
    const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :order",
        FilterExpression: "#owner = :owner",
        ExpressionAttributeNames: { "#owner": "owner" },
        ExpressionAttributeValues: { ":order": "ORDER", ":owner": claims.sub }
    }));
    const orders = (result.Items || [])
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map(publicOrder);
    return response(200, { orders });
}

export const handler = async (event) => {
    try {
        const claims = requireUser(event);
        if (event?.requestContext?.http?.method === "GET") return await readOrders(event, claims);
        const body = parseBody(event);
        const customer = validateCustomer(body.customer);
        const requested = normalizeItems(body.items);
        const idempotencyKey = cleanText(
            event?.headers?.["idempotency-key"] || event?.headers?.["Idempotency-Key"] || body.idempotencyKey,
            100
        );
        if (!idempotencyKey) return response(400, { message: "Idempotency-Key is required." });

        const existing = await db.send(new GetCommand({
            TableName: IDEMPOTENCY_TABLE,
            Key: { PK: `IDEMP#${claims.sub}#${idempotencyKey}` }
        }));
        if (existing.Item) return response(200, { orderId: existing.Item.orderId, status: "PENDING_PAYMENT", replayed: true });

        const products = await Promise.all(requested.map(async (item) => {
            const product = await getProduct(item.productId);
            if (!product) {
                const error = new Error(`Product ${item.productId} was not found.`);
                error.statusCode = 400;
                throw error;
            }
            return { ...item, name: product.name, unitPrice: Number(product.price), imageUrl: product.imageUrl };
        }));

        const subtotal = Number(products.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0).toFixed(2));
        const tax = Number((subtotal * 0.13).toFixed(2));
        const shipping = subtotal > 0 && subtotal < 100 ? 10 : 0;
        const total = Number((subtotal + tax + shipping).toFixed(2));
        const orderId = `ORD-${randomUUID()}`;
        const now = new Date().toISOString();
        const order = {
            PK: "ORDER", SK: orderId, orderId, owner: claims.sub,
            customer, items: products, currency: "CAD", subtotal, tax, shipping, total,
            status: "PENDING_PAYMENT", createdAt: now, updatedAt: now
        };

        const transaction = products.map((item) => ({
            Update: {
                TableName: TABLE_NAME,
                Key: { PK: "PRODUCT", SK: item.productId },
                UpdateExpression: "SET stock = stock - :qty",
                ConditionExpression: "attribute_exists(SK) AND stock >= :qty",
                ExpressionAttributeValues: { ":qty": item.quantity }
            }
        }));
        transaction.push(
            { Put: { TableName: TABLE_NAME, Item: order, ConditionExpression: "attribute_not_exists(SK)" } },
            { Put: {
                TableName: IDEMPOTENCY_TABLE,
                Item: { PK: `IDEMP#${claims.sub}#${idempotencyKey}`, orderId, expiresAt: Math.floor(Date.now() / 1000) + 86400 },
                ConditionExpression: "attribute_not_exists(PK)"
            }}
        );
        await db.send(new TransactWriteCommand({ TransactItems: transaction }));

        if (TOPIC_ARN) {
            await sns.send(new PublishCommand({
                TopicArn: TOPIC_ARN,
                Subject: "Bmazon order created",
                Message: JSON.stringify({ type: "ORDER_CREATED", orderId, owner: claims.sub, email: customer.email, total, currency: "CAD" })
            })).catch((error) => console.error("SNS publish failed after order commit", error));
        }
        return response(201, { orderId, status: order.status, total, currency: "CAD" });
    } catch (error) {
        if (error?.name === "TransactionCanceledException") {
            error.statusCode = 409;
            error.message = "The order could not be placed because stock changed or the request was already processed.";
        }
        return errorResponse(error);
    }
};
