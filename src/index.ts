import app from "./app.js";
import { config } from "./config.js";
import { createDefaultRealm } from "./keycloak/realm-setup.js";

// Get port from config
const port = config.server.port;

/**
 * Initializes the default realm on startup
 */
async function initializeDefaultRealm(): Promise<void> {
	try {
		console.log("→ Initializing default realm...");
		await createDefaultRealm();
		console.log("✓ Default realm initialized");
	} catch (error) {
		console.error("✗ Failed to initialize default realm:", error);
		throw error;
	}
}

await initializeDefaultRealm();

console.log(`
╔════════════════════════════════════════════════════════════╗
║           Cognito-Keycloak Local Development               ║
╠════════════════════════════════════════════════════════════╣
║  Cognito API:  http://localhost:${port}                        ║
║  User Pool ID: ${config.userPool.id.padEnd(41)}║
║  Keycloak:     ${config.keycloak.baseUrl.padEnd(41)}║
╚════════════════════════════════════════════════════════════╝
`);

// Export configuration for Bun's standalone executable feature
// When compiled with `bun build --compile`, Bun will auto-start a server
// using this export if it detects a `fetch` method
export default {
	port,
	fetch: app.fetch,
};
