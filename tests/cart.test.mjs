import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function cartRuntime() {
    const values = new Map();
    const context = {
        console,
        localStorage: {
            getItem: (key) => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value)
        },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
        document: { querySelectorAll: () => [], addEventListener: () => {} },
        window: { dispatchEvent: () => {} }
    };
    vm.createContext(context);
    vm.runInContext(await readFile(new URL("../assets/js/store.js", import.meta.url), "utf8"), context);
    return context.window.BmazonCart;
}

test("cart adds, caps, updates and removes products", async () => {
    const cart = await cartRuntime();
    const product = { productId: "P1", name: "Keyboard", price: 129.99, imageUrl: "keyboard.jpg", stock: 3 };
    cart.add(product, 2); cart.add(product, 5);
    assert.equal(cart.read()[0].quantity, 3);
    assert.equal(cart.count(), 3);
    assert.equal(cart.subtotal(), 389.97);
    cart.update("P1", 1);
    assert.equal(cart.count(), 1);
    cart.remove("P1");
    assert.equal(cart.read().length, 0);
});

test("cart rejects products without an ID", async () => {
    const cart = await cartRuntime();
    assert.throws(() => cart.add({ name: "Broken" }, 1), /valid product/i);
});
