import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

// The server is started by globalSetup.ts
const COGNITO_ENDPOINT = "http://localhost:9000";
const KEYCLOAK_ENDPOINT =
	process.env.KEYCLOAK_ENDPOINT || "http://localhost:8080";

export const USER_POOL_ID = process.env.USER_POOL_ID || "local_pool";

let cognitoClient: CognitoIdentityProviderClient | null = null;

export async function setupContainer(): Promise<{
	cognitoClient: CognitoIdentityProviderClient;
	cognitoEndpoint: string;
	keycloakEndpoint: string;
}> {
	if (cognitoClient) {
		return {
			cognitoClient,
			cognitoEndpoint: COGNITO_ENDPOINT,
			keycloakEndpoint: KEYCLOAK_ENDPOINT,
		};
	}

	console.log(`Connecting to Cognito API at ${COGNITO_ENDPOINT}...`);

	// Create Cognito client - server is already started by globalSetup
	cognitoClient = new CognitoIdentityProviderClient({
		endpoint: COGNITO_ENDPOINT,
		region: "us-east-1",
		credentials: {
			accessKeyId: "local",
			secretAccessKey: "local",
		},
	});

	console.log("Connected!");

	return {
		cognitoClient,
		cognitoEndpoint: COGNITO_ENDPOINT,
		keycloakEndpoint: KEYCLOAK_ENDPOINT,
	};
}

export async function teardownContainer(): Promise<void> {
	// Server is managed by globalSetup/globalTeardown
	cognitoClient = null;
}

export function getClient(): CognitoIdentityProviderClient {
	if (!cognitoClient) {
		throw new Error("Container not started. Call setupContainer() first.");
	}
	return cognitoClient;
}
