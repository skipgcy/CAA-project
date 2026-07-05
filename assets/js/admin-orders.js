(function () {
    "use strict";
    const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
    const nextStatus = { PAID: "PROCESSING", PROCESSING: "SHIPPED", SHIPPED: "DELIVERED" };
    function escapeHtml(value) { const node = document.createElement("div"); node.textContent = String(value ?? ""); return node.innerHTML; }
    function token() { return window.BmazonAuth.requireToken(); }
    async function update(orderId, status) {
        const message = document.getElementById("adminMessage"); message.className = "alert d-none";
        try {
            const response = await fetch(`${BMAZON_CONFIG.apiBaseUrl}/admin/orders/${encodeURIComponent(orderId)}`, { method: "PATCH",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` }, body: JSON.stringify({ status }) });
            const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || "Unable to update order.");
            message.textContent = `Order updated to ${status}. Customer email queued.`; message.className = "alert alert-success"; await load();
        } catch (error) { message.textContent = error.message; message.className = "alert alert-danger"; }
    }
    async function load() {
        const content = document.getElementById("adminOrdersContent");
        try {
            const response = await fetch(`${BMAZON_CONFIG.apiBaseUrl}/admin/orders`, { headers: { Authorization: `Bearer ${token()}` } });
            const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || "Unable to load admin orders.");
            content.innerHTML = `<div class="table-responsive"><table class="table table-hover align-middle"><thead class="table-light"><tr><th>Order</th><th>Customer</th><th>Date</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody>${body.orders.map((order) => { const next = nextStatus[order.status]; return `<tr><td><a href="order-detail.html?id=${encodeURIComponent(order.orderId)}"><code>${escapeHtml(order.orderId)}</code></a></td><td>${escapeHtml(order.customer.name)}<br><small>${escapeHtml(order.customer.email)}</small></td><td>${new Date(order.createdAt).toLocaleString("en-CA")}</td><td>${money.format(order.total)}</td><td><span class="badge bg-primary">${escapeHtml(order.status.replaceAll("_", " "))}</span></td><td>${next ? `<button class="btn btn-success btn-sm" data-id="${escapeHtml(order.orderId)}" data-status="${next}">Mark ${next}</button>` : '<span class="text-muted">Complete</span>'}</td></tr>`; }).join("")}</tbody></table></div>`;
            content.querySelectorAll("button[data-status]").forEach((button) => button.addEventListener("click", () => update(button.dataset.id, button.dataset.status)));
        } catch (error) { if (error.statusCode !== 401) content.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`; }
    }
    document.addEventListener("DOMContentLoaded", load);
})();
