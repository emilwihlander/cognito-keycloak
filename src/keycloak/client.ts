import KcAdminClient from "@keycloak/keycloak-admin-client";
import { config } from "../config";
import { CognitoException } from "../handlers/index.js";

async function authenticate(
	client: KcAdminClient,
	realmName: string,
): Promise<void> {
	client.setConfig({ realmName: "master" });
	await client.auth({
		grantType: "password",
		clientId: config.keycloak.clientId,
		username: config.keycloak.adminUsername,
		password: config.keycloak.adminPassword,
	});
	client.setConfig({ realmName });
}

const clients: Record<string, KcAdminClient> = {};

/**
 * Gets a Keycloak admin client configured for a specific realm
 * The client will be authenticated if not already authenticated
 * Note: The client shares authentication state, so authenticating once
 * allows access to all realms
 */
async function getClientForRealm(realmName: string): Promise<KcAdminClient> {
	if (clients[realmName]) {
		return clients[realmName];
	}

	// Create a new client instance for the specific realm
	const client = new KcAdminClient({
		baseUrl: config.keycloak.baseUrl,
		realmName,
	});

	clients[realmName] = client;

	await authenticate(client, realmName);

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
