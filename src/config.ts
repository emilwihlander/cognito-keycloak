// Configuration for the Cognito-Keycloak wrapper

export const config = {
	// Keycloak configuration
	keycloak: {
		baseUrl: process.env.KEYCLOAK_URL || "http://localhost:8080",
		realm: process.env.KEYCLOAK_REALM || "cognito",
		adminUsername: process.env.KC_BOOTSTRAP_ADMIN_USERNAME || "admin",
		adminPassword: process.env.KC_BOOTSTRAP_ADMIN_PASSWORD || "admin",
		clientId: process.env.KEYCLOAK_CLIENT_ID || "admin-cli",
	},

	// Cognito wrapper configuration
	server: {
		port: parseInt(process.env.PORT || "3000", 10),
	},

	// Hardcoded user pool for local development
	userPool: {
		id: process.env.USER_POOL_ID || "local_pool",
		name: "Local Development Pool",
	},
} as const;

export type Config = typeof config;
