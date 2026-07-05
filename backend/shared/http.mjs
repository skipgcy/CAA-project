export function response(statusCode, body) {
    return {
        statusCode,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(body)
    };
}

export function parseBody(event) {
    if (!event?.body) return {};
    try {
        const raw = event.isBase64Encoded
            ? Buffer.from(event.body, "base64").toString("utf8")
            : event.body;
        return JSON.parse(raw);
    } catch {
        const error = new Error("Request body must be valid JSON.");
        error.statusCode = 400;
        throw error;
    }
}

export function userClaims(event) {
    return event?.requestContext?.authorizer?.jwt?.claims || null;
}

export function requireUser(event) {
    const claims = userClaims(event);
    if (!claims?.sub) {
        const error = new Error("Authentication is required.");
        error.statusCode = 401;
        throw error;
    }
    return claims;
}

export function errorResponse(error) {
    const statusCode = Number(error?.statusCode) || 500;
    if (statusCode >= 500) console.error(error);
    return response(statusCode, {
        message: statusCode >= 500 ? "An internal service error occurred." : error.message
    });
}
