import { DeleteCommand, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { db, getProduct, TABLE_NAME } from "../../shared/data.mjs";
import { errorResponse, parseBody, requireUser, response } from "../../shared/http.mjs";

const s3 = new S3Client({});
const WEBSITE_BUCKET_NAME = process.env.WEBSITE_BUCKET_NAME;
const FRONTEND_URL = (process.env.FRONTEND_URL || "https://ezei.shop").replace(/\/$/, "");
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const IMAGE_TYPES = new Map([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/gif", "gif"]
]);

function requireAdmin(event) {
    const claims = requireUser(event);
    const raw = claims["cognito:groups"];
    const groups = Array.isArray(raw)
        ? raw
        : String(raw || "").replace(/^\[|\]$/g, "").split(",").map((value) => value.trim());
    if (!groups.includes("Admins")) {
        const error = new Error("Administrator access is required.");
        error.statusCode = 403;
        throw error;
    }
}

function cleanText(value, maxLength = 200) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanId(value) {
    return cleanText(value, 60)
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function cleanProductKey(value) {
    return cleanText(value, 80)
        .replace(/[^A-Za-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function cleanFileName(value) {
    return cleanText(value, 120)
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "") || "product-image";
}

function cleanNumber(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
        const error = new Error(`${field} must be a number between ${min} and ${max}.`);
        error.statusCode = 400;
        throw error;
    }
    return number;
}

function cleanInteger(value, field, { min = 0, max = 999999 } = {}) {
    const number = Number.parseInt(value, 10);
    if (!Number.isInteger(number) || number < min || number > max) {
        const error = new Error(`${field} must be an integer between ${min} and ${max}.`);
        error.statusCode = 400;
        throw error;
    }
    return number;
}

function cleanStringList(value, maxItems = 12) {
    if (Array.isArray(value)) {
        return value.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, maxItems);
    }
    if (typeof value === "string") {
        return value.split(/\r?\n|,/).map((item) => cleanText(item, 500)).filter(Boolean).slice(0, maxItems);
    }
    return [];
}

function normalizeProduct(input = {}, existing = null) {
    const productId = existing?.productId || cleanId(input.productId || input.name);
    const name = cleanText(input.name, 120);
    if (!productId || !name) {
        const error = new Error("Product ID and name are required.");
        error.statusCode = 400;
        throw error;
    }

    const imageUrl = cleanText(input.imageUrl, 1000);
    if (!imageUrl) {
        const error = new Error("A thumbnail image URL is required.");
        error.statusCode = 400;
        throw error;
    }

    return {
        PK: "PRODUCT",
        SK: productId,
        productId,
        name,
        brand: cleanText(input.brand, 80),
        category: cleanText(input.category, 80),
        model: cleanText(input.model, 80),
        color: cleanText(input.color, 80),
        price: Number(cleanNumber(input.price, "Price", { min: 0, max: 100000 }).toFixed(2)),
        stock: cleanInteger(input.stock, "Stock"),
        imageUrl,
        images: cleanStringList(input.images, 10),
        description: cleanText(input.description, 3000),
        specification: cleanStringList(input.specification, 20),
        rating: cleanNumber(input.rating ?? existing?.rating ?? 5, "Rating", { min: 0, max: 5 }),
        reviews: cleanInteger(input.reviews ?? existing?.reviews ?? 0, "Reviews"),
        isActive: input.isActive === undefined ? existing?.isActive !== false : Boolean(input.isActive)
    };
}

function publicProduct(product) {
    const { PK, SK, ...safe } = product;
    return { ...safe, id: SK };
}

async function listProducts() {
    const result = await db.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": "PRODUCT" }
    }));
    const products = (result.Items || [])
        .sort((a, b) => String(a.SK).localeCompare(String(b.SK)))
        .map(publicProduct);
    return response(200, { products });
}

async function uploadImage(event) {
    if (!WEBSITE_BUCKET_NAME) {
        const error = new Error("Image upload bucket is not configured.");
        error.statusCode = 500;
        throw error;
    }

    const body = parseBody(event);
    const contentType = cleanText(body.contentType, 80).toLowerCase();
    const extension = IMAGE_TYPES.get(contentType);
    if (!extension) {
        return response(400, { message: "Only JPG, PNG, WEBP, and GIF images are allowed." });
    }

    const base64 = String(body.data || "").replace(/^data:[^;]+;base64,/, "");
    let bytes;
    try {
        bytes = Buffer.from(base64, "base64");
    } catch {
        return response(400, { message: "Image data must be base64 encoded." });
    }
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
        return response(400, { message: "Image must be larger than 0 bytes and no more than 2.5 MB." });
    }

    const prefix = cleanId(body.productId || "draft") || "draft";
    const name = cleanFileName(body.fileName);
    const stamp = Date.now().toString(36);
    const key = `assets/img/products/${prefix}/${stamp}-${name}.${extension}`;

    await s3.send(new PutObjectCommand({
        Bucket: WEBSITE_BUCKET_NAME,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
        ServerSideEncryption: "AES256"
    }));

    return response(201, { key, url: `${FRONTEND_URL}/${key}` });
}

async function createProduct(event) {
    const body = parseBody(event);
    const now = new Date().toISOString();
    const product = { ...normalizeProduct(body), createdAt: now, updatedAt: now };
    await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: product,
        ConditionExpression: "attribute_not_exists(SK)"
    }));
    return response(201, { product: publicProduct(product) });
}

async function updateProduct(event) {
    const productId = cleanProductKey(event?.pathParameters?.id);
    if (!productId) return response(400, { message: "Product ID is required." });

    const existing = await getProduct(productId);
    if (!existing) return response(404, { message: "Product not found." });

    const body = parseBody(event);
    const now = new Date().toISOString();
    const product = {
        ...normalizeProduct({ ...existing, ...body, productId }, existing),
        createdAt: existing.createdAt || now,
        updatedAt: now
    };

    await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: product,
        ConditionExpression: "attribute_exists(SK)"
    }));
    return response(200, { product: publicProduct(product) });
}

async function deactivateProduct(event) {
    const productId = cleanProductKey(event?.pathParameters?.id);
    if (!productId) return response(400, { message: "Product ID is required." });

    const now = new Date().toISOString();
    const result = await db.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: "PRODUCT", SK: productId },
        UpdateExpression: "SET isActive = :inactive, updatedAt = :now",
        ConditionExpression: "attribute_exists(SK)",
        ExpressionAttributeValues: { ":inactive": false, ":now": now },
        ReturnValues: "ALL_NEW"
    }));
    return response(200, { product: publicProduct(result.Attributes) });
}

async function hardDeleteProduct(event) {
    const productId = cleanProductKey(event?.pathParameters?.id);
    if (!productId) return response(400, { message: "Product ID is required." });
    await db.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: "PRODUCT", SK: productId },
        ConditionExpression: "attribute_exists(SK)"
    }));
    return response(200, { productId, deleted: true });
}

export const handler = async (event) => {
    try {
        requireAdmin(event);
        const method = event?.requestContext?.http?.method;
        const path = event?.rawPath || event?.requestContext?.http?.path || "";
        if (method === "POST" && path.endsWith("/admin/products/images")) return await uploadImage(event);
        if (method === "GET") return await listProducts();
        if (method === "POST") return await createProduct(event);
        if (method === "PATCH") return await updateProduct(event);
        if (method === "DELETE") {
            const permanent = String(event?.queryStringParameters?.permanent || "").toLowerCase() === "true";
            return permanent ? await hardDeleteProduct(event) : await deactivateProduct(event);
        }
        return response(405, { message: "Method not allowed." });
    } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") {
            error.statusCode = 409;
            error.message = "The product could not be changed because the ID already exists or the product was removed.";
        }
        return errorResponse(error);
    }
};
