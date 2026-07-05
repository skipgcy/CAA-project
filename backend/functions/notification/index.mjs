import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { getOrder } from "../../shared/data.mjs";
import { errorResponse, requireUser, response } from "../../shared/http.mjs";

const sns = new SNSClient({});

export const handler = async (event) => {
    try {
        const claims = requireUser(event);
        const orderId = event?.pathParameters?.id;
        const order = await getOrder(orderId);
        if (!order) return response(404, { message: "Order not found." });
        if (order.owner !== claims.sub) return response(403, { message: "You cannot access this order." });
        await sns.send(new PublishCommand({
            TopicArn: process.env.ORDER_TOPIC_ARN,
            Subject: "Bmazon order notification",
            Message: JSON.stringify({ type: "ORDER_STATUS", orderId, status: order.status, email: order.customer.email, total: order.total, currency: order.currency })
        }));
        return response(202, { message: "Notification queued." });
    } catch (error) {
        return errorResponse(error);
    }
};
