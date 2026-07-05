(function (window) {
    "use strict";
    const config = window.BMAZON_CONFIG.cognito;
    const TOKEN_KEY = "bmazon.auth.tokens";

    function base64Url(bytes) {
        return btoa(String.fromCharCode(...new Uint8Array(bytes)))
            .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    function randomValue() {
        return base64Url(crypto.getRandomValues(new Uint8Array(32)));
    }

    function decodePayload(token) {
        try {
            const value = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
            return JSON.parse(atob(value));
        } catch { return null; }
    }

    function tokens() {
        const raw = sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
        if (!raw) return null;
        try {
            const value = JSON.parse(raw);
            const payload = decodePayload(value.access_token);
            if (!payload?.exp || payload.exp * 1000 <= Date.now()) return null;
            return value;
        } catch { return null; }
    }

    async function login(remember = false) {
        if (!sessionStorage.getItem("bmazon.returnTo")) {
            const returnTo = window.location.pathname.endsWith("/login.html")
                ? new URL("checkout.html", window.location.href).href
                : window.location.href;
            sessionStorage.setItem("bmazon.returnTo", returnTo);
        }
        const verifier = randomValue();
        const state = randomValue();
        const challenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
        sessionStorage.setItem("bmazon.pkce", JSON.stringify({ verifier, state, remember }));
        const params = new URLSearchParams({
            response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri,
            scope: config.scopes, state, code_challenge: challenge, code_challenge_method: "S256"
        });
        window.location.assign(`https://${config.domain}/oauth2/authorize?${params}`);
    }

    async function handleCallback() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        if (!code) return false;
        const pending = JSON.parse(sessionStorage.getItem("bmazon.pkce") || "null");
        if (!pending || pending.state !== params.get("state")) throw new Error("Invalid authentication state.");
        const body = new URLSearchParams({
            grant_type: "authorization_code", client_id: config.clientId, code,
            redirect_uri: config.redirectUri, code_verifier: pending.verifier
        });
        const result = await fetch(`https://${config.domain}/oauth2/token`, {
            method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body
        });
        const value = await result.json();
        if (!result.ok) throw new Error(value.error_description || "Cognito login failed.");
        (pending.remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, JSON.stringify(value));
        sessionStorage.removeItem("bmazon.pkce");
        history.replaceState({}, document.title, window.location.pathname);
        const returnTo = sessionStorage.getItem("bmazon.returnTo");
        sessionStorage.removeItem("bmazon.returnTo");
        if (returnTo) {
            const target = new URL(returnTo, window.location.origin);
            if (target.origin === window.location.origin && target.href !== window.location.href) {
                window.location.assign(target.href);
            }
        }
        return true;
    }

    function accessToken() { return tokens()?.access_token || null; }
    function currentUser() { return decodePayload(tokens()?.id_token); }
    function requireToken() {
        const token = accessToken();
        if (!token) {
            sessionStorage.setItem("bmazon.returnTo", window.location.href);
            login();
            const error = new Error("Redirecting to login.");
            error.statusCode = 401;
            throw error;
        }
        return token;
    }

    function logout() {
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
        const params = new URLSearchParams({ client_id: config.clientId, logout_uri: config.logoutUri });
        window.location.assign(`https://${config.domain}/logout?${params}`);
    }

    window.BmazonAuth = { login, logout, handleCallback, accessToken, currentUser, requireToken };
})(window);
