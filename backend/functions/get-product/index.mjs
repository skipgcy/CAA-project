import { getProduct } from "../../shared/data.mjs";
import { errorResponse, response } from "../../shared/http.mjs";

export const handler = async (event) => {
    try {
        const productId = event?.pathParameters?.id;
        if (!productId) return response(400, { message: "Product ID is required." });
        const product = await getProduct(productId);
        return product
            ? response(200, product)
            : response(404, { message: "Product not found." });
    } catch (error) {
        return errorResponse(error);
    }
};
