import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { cognito } from "./routes/cognito.js";
import { oauth } from "./routes/oauth.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
	"*",
	cors({
		origin: "*",
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowHeaders: [
			"Content-Type",
			"Authorization",
			"X-Amz-Target",
			"X-Amz-Date",
			"X-Amz-Security-Token",
			"X-Amz-Content-Sha256",
		],
		exposeHeaders: ["X-Amzn-RequestId"],
	}),
);

// Health check
app.get("/health", (c) => {
	return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Mount OAuth 2.0 routes (proxied to Keycloak)
app.route("/", oauth);

// Mount Cognito IDP API routes
app.route("/", cognito);

export default app;
