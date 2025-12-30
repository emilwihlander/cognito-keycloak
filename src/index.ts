import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "./config.js";
import { oauth } from "./routes/oauth.js";
import { cognito } from "./routes/cognito.js";

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
  })
);

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Mount OAuth 2.0 routes (proxied to Keycloak)
app.route("/", oauth);

// Mount Cognito IDP API routes
app.route("/", cognito);

// Start server
const port = config.server.port;

console.log(`
╔════════════════════════════════════════════════════════════╗
║           Cognito-Keycloak Local Development               ║
╠════════════════════════════════════════════════════════════╣
║  Cognito API:  http://localhost:${port}                        ║
║  User Pool ID: ${config.userPool.id.padEnd(41)}║
║  Keycloak:     ${config.keycloak.baseUrl.padEnd(41)}║
╚════════════════════════════════════════════════════════════╝
`);

serve({
  fetch: app.fetch,
  port,
});

export default app;

