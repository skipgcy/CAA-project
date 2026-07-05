window.BMAZON_CONFIG = Object.freeze({
    apiBaseUrl: "https://api.ezei.shop",
    currency: "CAD",
    taxRate: 0.13,
    freeShippingThreshold: 100,
    standardShipping: 10,
    cognito: {
        region: "us-east-1",
        domain: "us-east-1cxzowesml.auth.us-east-1.amazoncognito.com",
        userPoolId: "us-east-1_CXzowESmL",
        clientId: "1p0e84nqerhr6lktjd75j95rn0",
        redirectUri: "https://ezei.shop/checkout.html",
        logoutUri: "https://ezei.shop/index.html",
        scopes: "openid email phone"
    }
});
