(function () {
    "use strict";
    const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
    function escapeHtml(value) {
        const node = document.createElement("div");
        node.textContent = String(value ?? "");
        return node.innerHTML;
    }
    async function load() {
        const container = document.getElementById("orderContent");
        try {
            const id = new URLSearchParams(location.search).get("id");
            if (!id) throw new Error("No order ID was supplied.");
            const token = window.BmazonAuth.requireToken();
            const response = await fetch(`${window.BMAZON_CONFIG.apiBaseUrl}/orders/${encodeURIComponent(id)}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message || "Unable to load this order.");
            const order = body.order;
            const c = order.customer;
            container.innerHTML = `<div class="card shadow-sm"><div class="card-header d-flex justify-content-between">
                <strong>${escapeHtml(order.orderId)}</strong><span class="badge bg-success">${escapeHtml(order.status.replaceAll("_", " "))}</span>
                </div><div class="card-body">
                <p class="text-muted">Placed ${new Date(order.createdAt).toLocaleString("en-CA")}</p>
                <h2 class="h5">Items</h2>${order.items.map((item) => `<div class="d-flex align-items-center justify-content-between border-bottom py-3">
                    <div class="d-flex align-items-center gap-3"><img src="${escapeHtml(item.imageUrl)}" alt="" width="64" height="64" class="rounded" style="object-fit:cover">
                    <div><strong>${escapeHtml(item.name)}</strong><br><span class="text-muted">Quantity: ${item.quantity}</span></div></div>
                    <span>${money.format(item.unitPrice * item.quantity)}</span></div>`).join("")}
                <div class="row mt-4"><div class="col-md-6"><h2 class="h5">Shipping address</h2>
                    <p>${escapeHtml(c.name)}<br>${escapeHtml(c.address)}<br>${escapeHtml(c.city)}, ${escapeHtml(c.province)} ${escapeHtml(c.postalCode)}<br>${escapeHtml(c.email)}</p></div>
                    <div class="col-md-6"><h2 class="h5">Summary</h2>
                    <div class="d-flex justify-content-between"><span>Subtotal</span><span>${money.format(order.subtotal)}</span></div>
                    <div class="d-flex justify-content-between"><span>Tax</span><span>${money.format(order.tax)}</span></div>
                    <div class="d-flex justify-content-between"><span>Shipping</span><span>${money.format(order.shipping)}</span></div><hr>
                    <div class="d-flex justify-content-between h5"><span>Total</span><span>${money.format(order.total)}</span></div></div></div>
                </div></div>`;
        } catch (error) {
            if (error.statusCode !== 401) container.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
        }
    }
    document.addEventListener("DOMContentLoaded", load);
})();
