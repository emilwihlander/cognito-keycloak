import KcAdminClient from "@keycloak/keycloak-admin-client";
import { config } from "../config";

export const keycloakClient = new KcAdminClient({
	baseUrl: config.keycloak.baseUrl,
	realmName: config.keycloak.realm,
});

export async function authenticate(): Promise<void> {
	// Authenticate against the master realm where the admin user exists
	keycloakClient.setConfig({ realmName: "master" });

	await keycloakClient.auth({
		grantType: "password",
		clientId: "admin-cli",
		username: config.keycloak.adminUsername,
		password: config.keycloak.adminPassword,
	});

	// Switch back to the target realm for subsequent operations
	keycloakClient.setConfig({ realmName: config.keycloak.realm });
}
