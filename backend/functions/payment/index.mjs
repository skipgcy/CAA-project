import { getOrder } from "../../shared/data.mjs";
import { errorResponse, parseBody, requireUser, response } from "../../shared/http.mjs";
import { stripeRequest } from "../../shared/stripe.mjs";

function addLine(params, index, name, unitAmount, quantity = 1) {
    params.set(`line_items[${index}][price_data][currency]`, "cad");
    params.set(`line_items[${index}][price_data][product_data][name]`, name);
    params.set(`line_items[${index}][price_data][unit_amount]`, String(Math.round(unitAmount * 100)));
    params.set(`line_items[${index}][quantity]`, String(quantity));
}

export const handler = async (event) => {
    try {
        const claims = requireUser(event);
        const { orderId } = parseBody(event);
        if (!orderId) return response(400, { message: "Order ID is required." });
        const order = await getOrder(orderId);
        if (!order) return response(404, { message: "Order not found." });
        if (order.owner !== claims.sub) return response(403, { message: "You cannot pay for this order." });
        if (order.status === "PAID") return response(409, { message: "This order is already paid." });

        const params = new URLSearchParams();
        params.set("mode", "payment");
        params.set("client_reference_id", orderId);
        params.set("customer_email", order.customer.email);
        params.set("success_url", `${process.env.FRONTEND_URL}/order-confirmation.html?session_id={CHECKOUT_SESSION_ID}`);
        params.set("cancel_url", `${process.env.FRONTEND_URL}/checkout.html?payment=cancelled`);
        params.set("metadata[order_id]", orderId);
        params.set("metadata[owner]", claims.sub);
        order.items.forEach((item, index) => addLine(params, index, item.name, item.unitPrice, item.quantity));
        let index = order.items.length;
        if (order.tax) addLine(params, index++, "HST (13%)", order.tax);
        if (order.shipping) addLine(params, index, "Standard shipping", order.shipping);

        const session = await stripeRequest("/checkout/sessions", params);
        return response(200, { sessionId: session.id, checkoutUrl: session.url });
    } catch (error) {
        return errorResponse(error);
    }
};
