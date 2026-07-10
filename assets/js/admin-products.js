(function () {
    "use strict";

    const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
    let products = [];
    const maxImageBytes = 2.5 * 1024 * 1024;

    function escapeHtml(value) {
        const node = document.createElement("div");
        node.textContent = String(value ?? "");
        return node.innerHTML;
    }

    function productKey(product) {
        return product?.productId || product?.id || product?.SK || "";
    }

    function token() {
        return window.BmazonAuth.requireToken();
    }

    function showMessage(message, type = "success") {
        const element = document.getElementById("adminMessage");
        element.textContent = message;
        element.className = `alert alert-${type}`;
    }

    function clearMessage() {
        const element = document.getElementById("adminMessage");
        element.textContent = "";
        element.className = "alert d-none";
    }

    function productUploadPrefix() {
        return document.getElementById("editingProductId").value ||
            document.getElementById("productId").value ||
            document.getElementById("productName").value ||
            "draft";
    }

    function lines(value) {
        return String(value || "")
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean);
    }

    function setUploadStatus(message, type = "muted") {
        const element = document.getElementById("productUploadStatus");
        element.textContent = message;
        element.className = `form-text text-${type}`;
    }

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
            reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
            reader.readAsDataURL(file);
        });
    }

    async function uploadImage(file) {
        if (!file) return null;
        if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
            throw new Error(`${file.name} is not a supported image type.`);
        }
        if (file.size <= 0 || file.size > maxImageBytes) {
            throw new Error(`${file.name} must be no more than 2.5 MB.`);
        }

        const response = await fetch(`${BMAZON_CONFIG.apiBaseUrl}/admin/products/images`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token()}`
            },
            body: JSON.stringify({
                productId: productUploadPrefix(),
                fileName: file.name,
                contentType: file.type,
                data: await readFileAsBase64(file)
            })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || `Unable to upload ${file.name}.`);
        return body.url;
    }

    async function uploadThumbnail(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        clearMessage();
        setUploadStatus(`Uploading ${file.name}...`);
        try {
            const url = await uploadImage(file);
            document.getElementById("productImageUrl").value = url;
            setUploadStatus("Thumbnail uploaded and URL filled in.", "success");
        } catch (error) {
            setUploadStatus(error.message, "danger");
        } finally {
            event.target.value = "";
        }
    }

    async function uploadDetailImages(event) {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;
        clearMessage();
        const textarea = document.getElementById("productImages");
        setUploadStatus(`Uploading ${files.length} detail image${files.length > 1 ? "s" : ""}...`);
        try {
            const urls = [];
            for (const file of files) urls.push(await uploadImage(file));
            const existing = lines(textarea.value);
            textarea.value = [...existing, ...urls].join("\n");
            setUploadStatus(`${urls.length} detail image${urls.length > 1 ? "s" : ""} uploaded.`, "success");
        } catch (error) {
            setUploadStatus(error.message, "danger");
        } finally {
            event.target.value = "";
        }
    }

    function productPayload() {
        return {
            productId: document.getElementById("productId").value,
            name: document.getElementById("productName").value,
            price: Number(document.getElementById("productPrice").value),
            stock: Number.parseInt(document.getElementById("productStock").value, 10),
            brand: document.getElementById("productBrand").value,
            category: document.getElementById("productCategory").value,
            model: document.getElementById("productModel").value,
            color: document.getElementById("productColor").value,
            rating: Number(document.getElementById("productRating").value || 5),
            reviews: Number.parseInt(document.getElementById("productReviews").value || "0", 10),
            imageUrl: document.getElementById("productImageUrl").value,
            images: lines(document.getElementById("productImages").value),
            description: document.getElementById("productDescription").value,
            specification: lines(document.getElementById("productSpecification").value),
            isActive: document.getElementById("productIsActive").checked
        };
    }

    function resetForm() {
        document.getElementById("adminProductForm").reset();
        document.getElementById("editingProductId").value = "";
        document.getElementById("productId").disabled = false;
        document.getElementById("productIsActive").checked = true;
        document.getElementById("productRating").value = "5";
        document.getElementById("productReviews").value = "0";
        document.getElementById("productStock").value = "0";
        setUploadStatus("");
        document.getElementById("productFormTitle").textContent = "Add product";
        document.getElementById("saveProductButton").textContent = "Save product";
    }

    function fillForm(product) {
        const key = productKey(product);
        document.getElementById("editingProductId").value = key;
        document.getElementById("productId").value = key;
        document.getElementById("productId").disabled = true;
        document.getElementById("productName").value = product.name || "";
        document.getElementById("productPrice").value = product.price ?? "";
        document.getElementById("productStock").value = product.stock ?? 0;
        document.getElementById("productBrand").value = product.brand || "";
        document.getElementById("productCategory").value = product.category || "";
        document.getElementById("productModel").value = product.model || "";
        document.getElementById("productColor").value = product.color || "";
        document.getElementById("productRating").value = product.rating ?? 5;
        document.getElementById("productReviews").value = product.reviews ?? 0;
        document.getElementById("productImageUrl").value = product.imageUrl || "";
        document.getElementById("productImages").value = (product.images || []).join("\n");
        document.getElementById("productDescription").value = product.description || "";
        document.getElementById("productSpecification").value = (product.specification || []).join("\n");
        document.getElementById("productIsActive").checked = product.isActive !== false;
        document.getElementById("productFormTitle").textContent = `Edit ${product.name}`;
        document.getElementById("saveProductButton").textContent = "Update product";
        document.getElementById("products-tab").click();
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    async function saveProduct(event) {
        event.preventDefault();
        clearMessage();
        const editingId = document.getElementById("editingProductId").value;
        const method = editingId ? "PATCH" : "POST";
        const path = editingId ? `/admin/products/${encodeURIComponent(editingId)}` : "/admin/products";

        try {
            const response = await fetch(`${BMAZON_CONFIG.apiBaseUrl}${path}`, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token()}`
                },
                body: JSON.stringify(productPayload())
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message || "Unable to save product.");
            showMessage(editingId ? "Product updated." : "Product created.");
            resetForm();
            await loadProducts();
        } catch (error) {
            showMessage(error.message, "danger");
        }
    }

    async function deactivateProduct(productId) {
        clearMessage();
        const product = products.find((item) => productKey(item) === productId);
        const label = product?.name || productId;
        if (!confirm(`Hide "${label}" from the storefront? Existing orders will remain safe.`)) return;

        try {
            const response = await fetch(`${BMAZON_CONFIG.apiBaseUrl}/admin/products/${encodeURIComponent(productId)}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token()}` }
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message || "Unable to hide product.");
            showMessage("Product hidden from storefront.");
            await loadProducts();
        } catch (error) {
            showMessage(error.message, "danger");
        }
    }

    async function reactivateProduct(productId) {
        const product = products.find((item) => productKey(item) === productId);
        if (!product) return;
        clearMessage();
        try {
            const response = await fetch(`${BMAZON_CONFIG.apiBaseUrl}/admin/products/${encodeURIComponent(productId)}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token()}`
                },
                body: JSON.stringify({ ...product, isActive: true })
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message || "Unable to reactivate product.");
            showMessage("Product is visible again.");
            await loadProducts();
        } catch (error) {
            showMessage(error.message, "danger");
        }
    }

    function renderProducts() {
        const content = document.getElementById("adminProductsContent");
        if (!products.length) {
            content.innerHTML = '<div class="alert alert-info">No products yet. Add the first product from the form.</div>';
            return;
        }

        content.innerHTML = `
            <div class="table-responsive">
                <table class="table table-hover align-middle">
                    <thead class="table-light">
                        <tr>
                            <th>Product</th>
                            <th>Price</th>
                            <th>Stock</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${products.map((product) => {
                            const key = productKey(product);
                            return `
                            <tr>
                                <td>
                                    <div class="d-flex align-items-center gap-3">
                                        <img src="${escapeHtml(product.imageUrl)}" alt="" width="64" height="64" class="rounded" style="object-fit:cover">
                                        <div>
                                            <div class="fw-semibold">${escapeHtml(product.name)}</div>
                                            <small class="text-muted">${escapeHtml(key)} · ${escapeHtml(product.brand || "No brand")} · ${escapeHtml(product.category || "No category")}</small>
                                        </div>
                                    </div>
                                </td>
                                <td>${money.format(Number(product.price) || 0)}</td>
                                <td>${Number(product.stock) || 0}</td>
                                <td>${product.isActive === false ? '<span class="badge bg-secondary">Hidden</span>' : '<span class="badge bg-success">Visible</span>'}</td>
                                <td>
                                    <div class="btn-group btn-group-sm">
                                        <button class="btn btn-outline-success" data-edit="${escapeHtml(key)}">Edit</button>
                                        ${product.isActive === false
                                            ? `<button class="btn btn-outline-primary" data-reactivate="${escapeHtml(key)}">Reactivate</button>`
                                            : `<button class="btn btn-outline-danger" data-delete="${escapeHtml(key)}">Hide</button>`}
                                    </div>
                                </td>
                            </tr>
                        `; }).join("")}
                    </tbody>
                </table>
            </div>
        `;

        content.querySelectorAll("button[data-edit]").forEach((button) => {
            button.addEventListener("click", () => fillForm(products.find((item) => productKey(item) === button.dataset.edit)));
        });
        content.querySelectorAll("button[data-delete]").forEach((button) => {
            button.addEventListener("click", () => deactivateProduct(button.dataset.delete));
        });
        content.querySelectorAll("button[data-reactivate]").forEach((button) => {
            button.addEventListener("click", () => reactivateProduct(button.dataset.reactivate));
        });
    }

    async function loadProducts() {
        const content = document.getElementById("adminProductsContent");
        try {
            const response = await fetch(`${BMAZON_CONFIG.apiBaseUrl}/admin/products`, {
                headers: { Authorization: `Bearer ${token()}` },
                cache: "no-store"
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message || "Unable to load products.");
            products = body.products || [];
            renderProducts();
        } catch (error) {
            if (error.statusCode !== 401) {
                content.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
            }
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        document.getElementById("adminProductForm").addEventListener("submit", saveProduct);
        document.getElementById("resetProductForm").addEventListener("click", resetForm);
        document.getElementById("productThumbnailFile").addEventListener("change", uploadThumbnail);
        document.getElementById("productDetailFiles").addEventListener("change", uploadDetailImages);
        loadProducts();
    });
})();
