(function (window, document) {
    "use strict";

    const config = window.BMAZON_CONFIG;
    const money = new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: config.currency
    });

    function totals(cart) {
        const subtotal = window.BmazonCart.subtotal(cart);
        const tax = Number((subtotal * config.taxRate).toFixed(2));
        const shipping = subtotal > 0 && subtotal < config.freeShippingThreshold
            ? config.standardShipping
            : 0;
        return { subtotal, tax, shipping, total: subtotal + tax + shipping };
    }

    function render() {
        const cart = window.BmazonCart.read();
        const list = document.getElementById("checkoutItems");
        const placeOrder = document.getElementById("placeOrderButton");

        if (!cart.length) {
            list.innerHTML = '<div class="alert alert-warning">Your cart is empty. <a href="shop.html">Continue shopping</a>.</div>';
            placeOrder.disabled = true;
            return;
        }

        list.innerHTML = cart.map((item) => `
            <div class="d-flex justify-content-between border-bottom py-3">
                <div class="d-flex gap-3">
                    <img src="${item.imageUrl}" alt="" width="64" height="64" class="rounded" style="object-fit:cover">
                    <div><strong>${item.name}</strong><br><span class="text-muted">Quantity: ${item.quantity}</span></div>
                </div>
                <span>${money.format(item.price * item.quantity)}</span>
            </div>`).join("");

        const result = totals(cart);
        document.getElementById("checkoutSubtotal").textContent = money.format(result.subtotal);
        document.getElementById("checkoutTax").textContent = money.format(result.tax);
        document.getElementById("checkoutShipping").textContent = money.format(result.shipping);
        document.getElementById("checkoutTotal").textContent = money.format(result.total);
    }

    async function submit(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const button = document.getElementById("placeOrderButton");
        const message = document.getElementById("checkoutMessage");
        const cart = window.BmazonCart.read();

        if (!cart.length || !form.reportValidity()) return;

        const result = totals(cart);
        const idempotencyKey = sessionStorage.getItem("bmazon.checkoutKey") || crypto.randomUUID();
        sessionStorage.setItem("bmazon.checkoutKey", idempotencyKey);
        const order = {
            idempotencyKey,
            customer: {
                name: form.elements.customerName.value.trim(),
                email: form.elements.email.value.trim(),
                address: form.elements.address.value.trim(),
                city: form.elements.city.value.trim(),
                province: form.elements.province.value,
                postalCode: form.elements.postalCode.value.trim()
            },
            items: cart.map(({ productId, name, price, quantity }) => ({
                productId, name, price, quantity
            })),
            currency: config.currency,
            ...result
        };
        sessionStorage.setItem("bmazon.checkoutDraft", JSON.stringify(order.customer));

        button.disabled = true;
        button.textContent = "Preparing secure payment...";
        message.className = "alert d-none";

        try {
            const token = window.BmazonAuth.accessToken();
            if (!token) {
                await window.BmazonAuth.login();
                return;
            }
            const response = await fetch(`${config.apiBaseUrl}/orders`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Idempotency-Key": order.idempotencyKey,
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify(order)
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message || "The order service is unavailable.");

            const paymentResponse = await fetch(`${config.apiBaseUrl}/payment`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                body: JSON.stringify({ orderId: body.orderId })
            });
            const payment = await paymentResponse.json().catch(() => ({}));
            if (!paymentResponse.ok || !payment.checkoutUrl) {
                throw new Error(payment.message || "Stripe Checkout is unavailable.");
            }
            sessionStorage.setItem("bmazon.lastOrder", JSON.stringify(body));
            sessionStorage.removeItem("bmazon.checkoutDraft");
            window.location.assign(payment.checkoutUrl);
        } catch (error) {
            message.textContent = error.message;
            message.className = "alert alert-danger";
            button.disabled = false;
            button.textContent = "Continue to secure payment";
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        render();
        const form = document.getElementById("checkoutForm");
        try {
            const draft = JSON.parse(sessionStorage.getItem("bmazon.checkoutDraft") || "null");
            if (draft) {
                const formField = { name: "customerName" };
                Object.entries(draft).forEach(([name, value]) => {
                    const fieldName = formField[name] || name;
                    if (form.elements[fieldName]) form.elements[fieldName].value = value;
                });
            }
        } catch {
            sessionStorage.removeItem("bmazon.checkoutDraft");
        }
        form.addEventListener("submit", submit);
    });
})(window, document);
