import KcAdminClient from "@keycloak/keycloak-admin-client";
import type ClientRepresentation from "@keycloak/keycloak-admin-client/lib/defs/clientRepresentation.js";
import type ProtocolMapperRepresentation from "@keycloak/keycloak-admin-client/lib/defs/protocolMapperRepresentation.js";
import type RealmRepresentation from "@keycloak/keycloak-admin-client/lib/defs/realmRepresentation.js";
import { config } from "../config.js";

/**
 * Creates a realm representation with all required settings
 */
function createRealmRepresentation(realmName: string): RealmRepresentation {
	return {
		realm: realmName,
		enabled: true,
		displayName: `Cognito Emulator: ${realmName}`,
		registrationAllowed: false,
		resetPasswordAllowed: true,
		editUsernameAllowed: false,
		bruteForceProtected: false,
		loginWithEmailAllowed: true,
		duplicateEmailsAllowed: false,
		verifyEmail: false,
	};
}

/**
 * Creates the local_client client representation
 */
function createLocalClientRepresentation(): ClientRepresentation {
	return {
		clientId: "local_client",
		name: "Local Development Client",
		enabled: true,
		redirectUris: ["http://localhost/*"],
		webOrigins: ["*"],
		directAccessGrantsEnabled: true,
		serviceAccountsEnabled: false,
		publicClient: true,
		protocol: "openid-connect",
		standardFlowEnabled: true,
		implicitFlowEnabled: false,
		fullScopeAllowed: true,
	};
}

/**
 * Creates the cognito-groups-mapper protocol mapper
 */
function createGroupsMapper(): ProtocolMapperRepresentation {
	return {
		name: "cognito-groups-mapper",
		protocol: "openid-connect",
		protocolMapper: "oidc-group-membership-mapper",
		config: {
			"full.path": "false",
			"id.token.claim": "true",
			"access.token.claim": "true",
			"claim.name": "cognito:groups",
			"userinfo.token.claim": "true",
		},
	};
}

/**
 * Creates the client-id-mapper protocol mapper
 */
function createClientIdMapper(): ProtocolMapperRepresentation {
	return {
		name: "client-id-mapper",
		protocol: "openid-connect",
		protocolMapper: "oidc-hardcoded-claim-mapper",
		config: {
			"claim.value": "local_client",
			"id.token.claim": "true",
			"access.token.claim": "true",
			"claim.name": "client_id",
			"jsonType.label": "String",
		},
	};
}

/**
 * Creates an authenticated admin client for realm operations
 * Must authenticate against master realm
 */
async function getAdminClient(): Promise<KcAdminClient> {
	const adminClient = new KcAdminClient({
		baseUrl: config.keycloak.baseUrl,
		realmName: "master",
	});

	await adminClient.auth({
		grantType: "password",
		clientId: config.keycloak.clientId,
		username: config.keycloak.adminUsername,
		password: config.keycloak.adminPassword,
	});

	return adminClient;
}

/**
 * Checks if a realm exists
 */
async function realmExists(
	adminClient: KcAdminClient,
	realmName: string,
): Promise<boolean> {
	const realms = await adminClient.realms.find();
	return realms.some((realm) => realm.realm === realmName);
}

/**
 * Creates a realm with all required settings, client, and protocol mappers
 */
export async function createRealm(realmName: string): Promise<void> {
	const adminClient = await getAdminClient();

	// Check if realm already exists
	if (await realmExists(adminClient, realmName)) {
		console.log(`Realm ${realmName} already exists, skipping creation`);
		return;
	}

	console.log(`Creating realm ${realmName}...`);

	// Create the realm
	const realmRep = createRealmRepresentation(realmName);
	await adminClient.realms.create(realmRep);

	console.log(`Realm ${realmName} created`);

	// Switch admin client to the new realm for client operations
	adminClient.setConfig({ realmName });

	// Create the local_client
	const clientRep = createLocalClientRepresentation();
	const createdClient = await adminClient.clients.create(clientRep);

	console.log(`Client local_client created in realm ${realmName}`);

	// Add protocol mappers to the client
	const groupsMapper = createGroupsMapper();
	const clientIdMapper = createClientIdMapper();

	await adminClient.clients.addProtocolMapper(
		{
			id: createdClient.id!,
		},
		groupsMapper,
	);

	await adminClient.clients.addProtocolMapper(
		{
			id: createdClient.id!,
		},
		clientIdMapper,
	);

	console.log(
		`Protocol mappers added to client local_client in realm ${realmName}`,
	);
}

/**
 * Creates the default realm based on configuration
 */
export async function createDefaultRealm(): Promise<void> {
	const defaultRealmName = config.userPool.id;
	await createRealm(defaultRealmName);
}
