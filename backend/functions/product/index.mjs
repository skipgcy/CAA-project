import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME } from "../../shared/data.mjs";
import { errorResponse, response } from "../../shared/http.mjs";

export const handler = async () => {
    try {
        const result = await db.send(new ScanCommand({
            TableName: TABLE_NAME,
            FilterExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": "PRODUCT" },
            ProjectionExpression: "PK, SK, productId, #n, price, color, brand, category, stock, imageUrl, images, description, specification, rating, reviews",
            ExpressionAttributeNames: { "#n": "name" }
        }));
        const products = (result.Items || []).sort((a, b) => a.SK.localeCompare(b.SK));
        return response(200, products);
    } catch (error) {
        return errorResponse(error);
    }
};
