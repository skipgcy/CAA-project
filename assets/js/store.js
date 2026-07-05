(function (window, document) {
    "use strict";

    const CART_KEY = "bmazon.cart.v1";
    const OLD_ASSET_ORIGIN = "https://chenyu-caa900-project.s3.us-east-1.amazonaws.com";

    function assetUrl(value) {
        return typeof value === "string" && value.startsWith(OLD_ASSET_ORIGIN)
            ? value.replace(OLD_ASSET_ORIGIN, window.location.origin)
            : value;
    }

    function readCart() {
        try {
            const value = JSON.parse(localStorage.getItem(CART_KEY));
            return Array.isArray(value)
                ? value.map((item) => ({ ...item, imageUrl: assetUrl(item.imageUrl) }))
                : [];
        } catch (error) {
            console.warn("Unable to read shopping cart", error);
            return [];
        }
    }

    function writeCart(cart) {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
        updateBadges(cart);
        window.dispatchEvent(new CustomEvent("bmazon:cart-updated", { detail: cart }));
    }

    function normalizeQuantity(quantity) {
        const parsed = Number.parseInt(quantity, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    }

    function add(product, quantity) {
        if (!product || !product.productId) {
            throw new Error("A valid product is required");
        }

        const cart = readCart();
        const requested = normalizeQuantity(quantity);
        const existing = cart.find((item) => item.productId === product.productId);

        if (existing) {
            existing.quantity = Math.min(
                normalizeQuantity(existing.quantity) + requested,
                Number(product.stock) || Number.MAX_SAFE_INTEGER
            );
        } else {
            cart.push({
                productId: product.productId,
                name: product.name,
                price: Number(product.price),
                imageUrl: assetUrl(product.imageUrl),
                quantity: Math.min(requested, Number(product.stock) || requested)
            });
        }

        writeCart(cart);
        return cart;
    }

    function update(productId, quantity) {
        const cart = readCart();
        const item = cart.find((entry) => entry.productId === productId);
        if (!item) return cart;

        item.quantity = normalizeQuantity(quantity);
        writeCart(cart);
        return cart;
    }

    function remove(productId) {
        const cart = readCart().filter((item) => item.productId !== productId);
        writeCart(cart);
        return cart;
    }

    function clear() {
        writeCart([]);
    }

    function count(cart) {
        return (cart || readCart()).reduce(
            (total, item) => total + normalizeQuantity(item.quantity),
            0
        );
    }

    function subtotal(cart) {
        return (cart || readCart()).reduce(
            (total, item) => total + Number(item.price) * normalizeQuantity(item.quantity),
            0
        );
    }

    function updateBadges(cart) {
        const value = count(cart);
        document.querySelectorAll("[data-cart-count]").forEach((badge) => {
            badge.textContent = value;
        });

        document.querySelectorAll('a[href="cart.html"] .badge').forEach((badge) => {
            badge.textContent = value;
        });
    }

    window.BmazonCart = { read: readCart, add, update, remove, clear, count, subtotal };
    document.addEventListener("DOMContentLoaded", () => updateBadges(readCart()));
})(window, document);
