import KcAdminClient from "@keycloak/keycloak-admin-client";
import { config } from "../config";
import { CognitoException } from "../handlers/index.js";

// Default client using the configured realm (for backward compatibility)
export const keycloakClient = new KcAdminClient({
	baseUrl: config.keycloak.baseUrl,
	realmName: config.userPool.id,
});

// Track authentication state
let isAuthenticated = false;

/**
 * Authenticates the admin client against the master realm
 * This must be called before any realm operations
 */
export async function authenticate(): Promise<void> {
	if (isAuthenticated) {
		return;
	}

	// Authenticate against the master realm where the admin user exists
	keycloakClient.setConfig({ realmName: "master" });

	await keycloakClient.auth({
		grantType: "password",
		clientId: config.keycloak.clientId,
		username: config.keycloak.adminUsername,
		password: config.keycloak.adminPassword,
	});

	isAuthenticated = true;

	// Switch back to the default realm for subsequent operations
	keycloakClient.setConfig({ realmName: config.userPool.id });
}

/**
 * Gets a Keycloak admin client configured for a specific realm
 * The client will be authenticated if not already authenticated
 * Note: The client shares authentication state, so authenticating once
 * allows access to all realms
 */
export async function getClientForRealm(
	realmName: string,
): Promise<KcAdminClient> {
	// Ensure we're authenticated first
	await authenticate();

	// Create a new client instance for the specific realm
	const client = new KcAdminClient({
		baseUrl: config.keycloak.baseUrl,
		realmName,
	});

	// Authenticate this client (it will reuse the same credentials)
	// We authenticate against master but then switch to the target realm
	client.setConfig({ realmName: "master" });
	await client.auth({
		grantType: "password",
		clientId: config.keycloak.clientId,
		username: config.keycloak.adminUsername,
		password: config.keycloak.adminPassword,
	});

	// Switch to the target realm
	client.setConfig({ realmName });

	return client;
}

/**
 * Gets a Keycloak admin client for a user pool (realm)
 * Extracts UserPoolId from the request and returns the appropriate client
 * @param request - Request object that contains UserPoolId
 * @returns Keycloak admin client configured for the user pool's realm
 * @throws CognitoException if UserPoolId is missing
 */
export async function getClientForUserPool(request: {
	UserPoolId?: string;
}): Promise<KcAdminClient> {
	if (!request.UserPoolId) {
		throw new CognitoException(
			"InvalidParameterException",
			"1 validation error detected: Value at 'userPoolId' failed to satisfy constraint: Member must not be null",
			400,
		);
	}
	return getClientForRealm(request.UserPoolId);
}
