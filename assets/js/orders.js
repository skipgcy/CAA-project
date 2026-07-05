(function () {
    "use strict";
    const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
    const statusStyle = {
        PAID: "bg-success", PENDING_PAYMENT: "bg-warning text-dark",
        PROCESSING: "bg-primary", SHIPPED: "bg-info text-dark",
        DELIVERED: "bg-success", CANCELLED: "bg-secondary"
    };

    function escapeHtml(value) {
        const node = document.createElement("div");
        node.textContent = String(value ?? "");
        return node.innerHTML;
    }

    async function load() {
        const container = document.getElementById("ordersContent");
        try {
            const token = window.BmazonAuth.requireToken();
            const response = await fetch(`${window.BMAZON_CONFIG.apiBaseUrl}/orders`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message || "Unable to load orders.");
            if (!body.orders?.length) {
                container.innerHTML = '<div class="alert alert-info">You have no orders yet. <a href="shop.html">Start shopping</a>.</div>';
                return;
            }
            container.innerHTML = `<div class="table-responsive"><table class="table table-hover align-middle">
                <thead class="table-light"><tr><th>Order</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead>
                <tbody>${body.orders.map((order) => `<tr>
                    <td><code>${escapeHtml(order.orderId)}</code></td>
                    <td>${new Date(order.createdAt).toLocaleString("en-CA")}</td>
                    <td>${escapeHtml(order.items.map((item) => `${item.name} × ${item.quantity}`).join(", "))}</td>
                    <td>${money.format(order.total)}</td>
                    <td><span class="badge ${statusStyle[order.status] || "bg-secondary"}">${escapeHtml(order.status.replaceAll("_", " "))}</span></td>
                    <td><a class="btn btn-outline-success btn-sm" href="order-detail.html?id=${encodeURIComponent(order.orderId)}">Details</a></td>
                </tr>`).join("")}</tbody></table></div>`;
        } catch (error) {
            if (error.statusCode !== 401) container.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
        }
    }
    document.addEventListener("DOMContentLoaded", load);
})();
