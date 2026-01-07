import app from "./app.js";
import { config } from "./config.js";

// Get port from config
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

// Check if we're running in Bun
const isBun = typeof Bun !== "undefined";

if (isBun) {
	// For Bun standalone executable, export server config for Bun to auto-start
	// This prevents double server start when compiled with --compile
} else {
	// For Node.js, use @hono/node-server
	const { serve } = await import("@hono/node-server");
	serve({
		fetch: app.fetch,
		port,
	});
}

// Export configuration for Bun's standalone executable feature
// When compiled with `bun build --compile`, Bun will auto-start a server
// using this export if it detects a `fetch` method
export default {
	port,
	fetch: app.fetch,
};
