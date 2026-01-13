import { Hono } from "hono";
import { config } from "../config.js";

const oauth = new Hono();

const keycloakBaseUrl = config.keycloak.baseUrl;
const realm = config.keycloak.realm;

/**
 * Proxy a request to Keycloak, preserving headers and body
 */
async function proxyToKeycloak(
	keycloakPath: string,
	request: Request,
	options?: {
		method?: string;
		preserveHost?: boolean;
	},
): Promise<Response> {
	const url = `${keycloakBaseUrl}${keycloakPath}`;

	// Copy relevant headers
	const headers = new Headers();
	const headersToForward = [
		"content-type",
		"authorization",
		"accept",
		"accept-language",
		"cookie",
	];

	for (const header of headersToForward) {
		const value = request.headers.get(header);
		if (value) {
			headers.set(header, value);
		}
	}

	// Get request body if present
	let body: BodyInit | undefined;
	if (request.method !== "GET" && request.method !== "HEAD") {
		body = await request.text();
	}

	const response = await fetch(url, {
		method: options?.method || request.method,
		headers,
		body,
		redirect: "manual", // Don't follow redirects, pass them through
	});

	// Create response with same status and headers
	const responseHeaders = new Headers();

	// Copy response headers, adjusting location if needed
	response.headers.forEach((value, key) => {
		// Rewrite Location header to point to our server
		if (key.toLowerCase() === "location") {
			// Replace Keycloak URL with our URL
			value = value.replace(
				`${keycloakBaseUrl}/realms/${realm}/protocol/openid-connect`,
				"",
			);
		}
		responseHeaders.set(key, value);
	});

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: responseHeaders,
	});
}

// ============ OpenID Connect Discovery ============

/**
 * Copied from an actual Cognito IDP. Base URLs are replaced with the local base URL.
 */
const BASE_URL = `http://localhost:${config.server.port}`;
const OPENID_CONFIGURATION = {
	authorization_endpoint: `${BASE_URL}/oauth2/authorize`,
	end_session_endpoint: `${BASE_URL}/logout`,
	id_token_signing_alg_values_supported: ["RS256"],
	issuer: BASE_URL,
	jwks_uri: `${BASE_URL}/.well-known/jwks.json`,
	response_types_supported: ["code", "token"],
	revocation_endpoint: `${BASE_URL}/oauth2/revoke`,
	scopes_supported: ["openid", "email", "phone", "profile"],
	subject_types_supported: ["public"],
	token_endpoint: `${BASE_URL}/oauth2/token`,
	token_endpoint_auth_methods_supported: [
		"client_secret_basic",
		"client_secret_post",
	],
	userinfo_endpoint: `${BASE_URL}/oauth2/userInfo`,
} as const;

/**
 * OpenID Connect Discovery document
 * Proxies to Keycloak but rewrites URLs to point to our server
 */
oauth.get("/.well-known/openid-configuration", async (c) => {
	return c.json(OPENID_CONFIGURATION);
});

/**
 * JWKS endpoint - returns Keycloak's public keys
 */
oauth.get("/.well-known/jwks.json", async (c) => {
	const keycloakPath = `/realms/${realm}/protocol/openid-connect/certs`;
	return proxyToKeycloak(keycloakPath, c.req.raw);
});

// ============ OAuth 2.0 / OIDC Endpoints ============

/**
 * Authorization endpoint
 * Redirects to Keycloak's authorization page
 */
oauth.get("/oauth2/authorize", async (c) => {
	const keycloakPath = `/realms/${realm}/protocol/openid-connect/auth`;

	// Forward all query parameters
	const queryString = c.req.url.split("?")[1] || "";
	const fullPath = queryString
		? `${keycloakPath}?${queryString}`
		: keycloakPath;

	return proxyToKeycloak(fullPath, c.req.raw);
});

/**
 * Together with the authorization endpoint, there are multiple resources such as css, js, and images
 * hosted under /resources/ that should all be proxied to Keycloak.
 */
oauth.get("/resources/*", async (c) => {
	return proxyToKeycloak(c.req.path, c.req.raw);
});

/**
 * Token endpoint
 * Exchanges authorization codes for tokens
 */
oauth.post("/oauth2/token", async (c) => {
	const keycloakPath = `/realms/${realm}/protocol/openid-connect/token`;
	return proxyToKeycloak(keycloakPath, c.req.raw);
});

/**
 * UserInfo endpoint
 */
oauth.get("/oauth2/userInfo", async (c) => {
	const keycloakPath = `/realms/${realm}/protocol/openid-connect/userinfo`;
	return proxyToKeycloak(keycloakPath, c.req.raw);
});

oauth.post("/oauth2/userInfo", async (c) => {
	const keycloakPath = `/realms/${realm}/protocol/openid-connect/userinfo`;
	return proxyToKeycloak(keycloakPath, c.req.raw);
});

/**
 * Token revocation endpoint
 */
oauth.post("/oauth2/revoke", async (c) => {
	const keycloakPath = `/realms/${realm}/protocol/openid-connect/revoke`;
	return proxyToKeycloak(keycloakPath, c.req.raw);
});

/**
 * Logout endpoint
 */
oauth.get("/logout", async (c) => {
	const keycloakPath = `/realms/${realm}/protocol/openid-connect/logout`;
	const queryString = c.req.url.split("?")[1] || "";
	const fullPath = queryString
		? `${keycloakPath}?${queryString}`
		: keycloakPath;
	return proxyToKeycloak(fullPath, c.req.raw);
});

oauth.post("/logout", async (c) => {
	const keycloakPath = `/realms/${realm}/protocol/openid-connect/logout`;
	return proxyToKeycloak(keycloakPath, c.req.raw);
});

/**
 * Introspection endpoint
 */
oauth.post("/oauth2/introspect", async (c) => {
	const keycloakPath = `/realms/${realm}/protocol/openid-connect/token/introspect`;
	return proxyToKeycloak(keycloakPath, c.req.raw);
});

export { oauth };
