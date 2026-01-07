import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import app from "../src/app.js";

const COGNITO_URL = "http://localhost:9000";
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || "http://localhost:8080";

export const USER_POOL_ID = process.env.USER_POOL_ID || "local_pool";

let server: ServerType | null = null;
let cognitoClient: CognitoIdentityProviderClient | null = null;

async function startServer(): Promise<void> {
	if (server) return;

	server = serve({
		fetch: app.fetch,
		port: 9000,
	});

	// Wait for server to be ready
	const maxRetries = 50;
	for (let i = 0; i < maxRetries; i++) {
		try {
			const response = await fetch("http://localhost:9000/health");
			if (response.ok) {
				console.log("\n✓ Cognito API server started on port 9000\n");
				return;
			}
		} catch {
			// Server not ready yet
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("Server failed to start");
}

export async function setupEnvironment(): Promise<{
	cognitoClient: CognitoIdentityProviderClient;
	cognitoEndpoint: string;
	keycloakEndpoint: string;
}> {
	// Start server if not already running
	await startServer();

	if (cognitoClient) {
		return {
			cognitoClient,
			cognitoEndpoint: COGNITO_URL,
			keycloakEndpoint: KEYCLOAK_URL,
		};
	}

	console.log(`Connecting to Cognito API at ${COGNITO_URL}...`);

	cognitoClient = new CognitoIdentityProviderClient({
		endpoint: COGNITO_URL,
		region: "us-east-1",
		credentials: {
			accessKeyId: "local",
			secretAccessKey: "local",
		},
	});

	console.log("Connected!");

	return {
		cognitoClient,
		cognitoEndpoint: COGNITO_URL,
		keycloakEndpoint: KEYCLOAK_URL,
	};
}

export function getClient(): CognitoIdentityProviderClient {
	if (!cognitoClient) {
		throw new Error("Container not started. Call setupContainer() first.");
	}
	return cognitoClient;
}
