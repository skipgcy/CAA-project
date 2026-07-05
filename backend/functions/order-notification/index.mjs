import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { getOrder } from "../../shared/data.mjs";

const ses = new SESClient({});
const money = (value, currency = "CAD") => new Intl.NumberFormat("en-CA", {
    style: "currency", currency
}).format(Number(value || 0));

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
}

function emailContent(message, order) {
    const paid = message.type === "ORDER_PAID" || order.status === "PAID";
    const statusCopy = {
        PROCESSING: ["Order processing", "We are preparing your items for shipment."],
        SHIPPED: ["Your order has shipped", "Your package is on its way."],
        DELIVERED: ["Order delivered", "Your order has been marked as delivered. We hope you enjoy it!"]
    };
    const [heading, intro] = statusCopy[message.status] || (paid
        ? ["Payment confirmed", "Your payment was successful. We are now preparing your order."]
        : ["Thanks for your order", "We received your order and are waiting for payment confirmation."]);
    const subject = `${heading} — ${order.orderId}`;
    const orderUrl = `${process.env.FRONTEND_URL}/order-detail.html?id=${encodeURIComponent(order.orderId)}`;
    const rows = order.items.map((item) => `<tr>
        <td style="padding:14px 0;border-bottom:1px solid #e8ecef;color:#263238"><strong>${escapeHtml(item.name)}</strong><br><span style="color:#607d8b;font-size:13px">Qty ${item.quantity}</span></td>
        <td align="right" style="padding:14px 0;border-bottom:1px solid #e8ecef;color:#263238">${money(item.unitPrice * item.quantity, order.currency)}</td>
    </tr>`).join("");
    const html = `<!doctype html><html><body style="margin:0;background:#f3f6f4;font-family:Arial,sans-serif;color:#263238">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f4;padding:28px 12px"><tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.08)">
        <tr><td style="background:#198754;padding:26px 34px;color:#fff"><div style="font-size:28px;font-weight:700">Bmazon</div><div style="opacity:.9;margin-top:5px">Secure online shopping</div></td></tr>
        <tr><td style="padding:34px"><h1 style="font-size:25px;margin:0 0 12px;color:#173f2b">${heading}</h1><p style="line-height:1.6;margin:0 0 24px;color:#546e7a">Hi ${escapeHtml(order.customer.name)}, ${intro}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5faf7;border-radius:10px;padding:18px;margin-bottom:24px"><tr><td><strong>Order</strong><br><span style="font-size:13px;color:#607d8b">${escapeHtml(order.orderId)}</span></td><td align="right"><strong>${escapeHtml(order.status.replaceAll("_", " "))}</strong><br><span style="font-size:13px;color:#607d8b">${new Date(order.createdAt).toLocaleDateString("en-CA")}</span></td></tr></table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px"><tr><td style="padding:5px 0;color:#607d8b">Subtotal</td><td align="right">${money(order.subtotal, order.currency)}</td></tr><tr><td style="padding:5px 0;color:#607d8b">HST</td><td align="right">${money(order.tax, order.currency)}</td></tr><tr><td style="padding:5px 0;color:#607d8b">Shipping</td><td align="right">${money(order.shipping, order.currency)}</td></tr><tr><td style="padding:14px 0 5px;font-size:18px"><strong>Total</strong></td><td align="right" style="font-size:18px"><strong>${money(order.total, order.currency)}</strong></td></tr></table>
          <div style="margin:26px 0"><a href="${escapeHtml(orderUrl)}" style="display:inline-block;background:#198754;color:#fff;text-decoration:none;padding:13px 22px;border-radius:8px;font-weight:700">View order details</a></div>
          <div style="border-top:1px solid #e8ecef;padding-top:20px"><strong>Shipping to</strong><p style="line-height:1.6;color:#607d8b;margin-bottom:0">${escapeHtml(order.customer.name)}<br>${escapeHtml(order.customer.address)}<br>${escapeHtml(order.customer.city)}, ${escapeHtml(order.customer.province)} ${escapeHtml(order.customer.postalCode)}</p></div>
        </td></tr><tr><td style="background:#173f2b;color:#cfe5d8;padding:20px 34px;font-size:12px">This automated receipt was sent by Bmazon. Please keep it for your records.</td></tr>
      </table></td></tr></table></body></html>`;
    const text = [heading, intro, `Order: ${order.orderId}`, `Status: ${order.status}`,
        ...order.items.map((item) => `${item.name} x ${item.quantity}: ${money(item.unitPrice * item.quantity, order.currency)}`),
        `Total: ${money(order.total, order.currency)}`, `View order: ${orderUrl}`].join("\n");
    return { subject, html, text };
}

export const handler = async (event) => {
    let processed = 0;
    for (const record of event.Records || []) {
        const message = JSON.parse(record.Sns.Message);
        if (!message.orderId || !process.env.FROM_EMAIL) continue;
        const order = await getOrder(message.orderId);
        if (!order?.customer?.email) continue;
        const content = emailContent(message, order);
        await ses.send(new SendEmailCommand({
            Source: process.env.FROM_EMAIL,
            Destination: { ToAddresses: [order.customer.email] },
            Message: {
                Subject: { Data: content.subject, Charset: "UTF-8" },
                Body: {
                    Html: { Data: content.html, Charset: "UTF-8" },
                    Text: { Data: content.text, Charset: "UTF-8" }
                }
            }
        }));
        processed++;
    }
    return { processed };
};
