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

// Export configuration for Bun's standalone executable feature
// When compiled with `bun build --compile`, Bun will auto-start a server
// using this export if it detects a `fetch` method
export default {
	port,
	fetch: app.fetch,
};
