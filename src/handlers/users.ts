import type {
	AdminCreateUserRequest,
	AdminCreateUserResponse,
	AdminDeleteUserRequest,
	AdminDisableUserRequest,
	AdminDisableUserResponse,
	AdminEnableUserRequest,
	AdminEnableUserResponse,
	AdminGetUserRequest,
	AdminGetUserResponse,
	AdminSetUserPasswordRequest,
	AdminSetUserPasswordResponse,
	AdminUpdateUserAttributesRequest,
	AdminUpdateUserAttributesResponse,
	ListUsersRequest,
	ListUsersResponse,
	UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import type UserRepresentation from "@keycloak/keycloak-admin-client/lib/defs/userRepresentation.js";
import { authenticate, keycloakClient } from "../keycloak/client.js";
import { CognitoException } from "./index.js";
import {
	cognitoToKeycloakAttributes,
	getAttributeValue,
	getRequiredUser,
	keycloakToCognitoAttributes,
	keycloakToCognitoUser,
	requireUsername,
} from "./utils.js";

// ============ User Action Handlers ============

async function adminCreateUser(
	request: AdminCreateUserRequest,
): Promise<AdminCreateUserResponse> {
	await authenticate();
	const { Username, UserAttributes, TemporaryPassword, MessageAction } =
		request;
	requireUsername(Username);

	// Extract email, name, and email_verified from attributes
	const email = getAttributeValue(UserAttributes, "email");
	const firstName = getAttributeValue(UserAttributes, "given_name");
	const lastName = getAttributeValue(UserAttributes, "family_name");
	const emailVerifiedAttr = getAttributeValue(UserAttributes, "email_verified");

	// Build Keycloak user payload
	const now = new Date().toISOString();
	const keycloakPayload = {
		username: Username,
		email,
		firstName,
		lastName,
		enabled: true,
		emailVerified: emailVerifiedAttr === "true" || MessageAction === "SUPPRESS",
		attributes: {
			...cognitoToKeycloakAttributes(UserAttributes),
			lastModifiedDate: [now],
		},
		credentials: TemporaryPassword
			? [
					{
						type: "password",
						value: TemporaryPassword,
						temporary: true,
					},
				]
			: undefined,
	};

	const result = await keycloakClient.users.create(keycloakPayload);

	// Validate that we got a valid user ID back from Keycloak
	if (!result.id) {
		throw new CognitoException(
			"InternalErrorException",
			"Failed to create user: no user ID returned from identity provider",
			500,
		);
	}

	// Fetch the created user to return full details
	// Keycloak will have set requiredActions: ["UPDATE_PASSWORD"] if temporary password was used
	const createdUser = await keycloakClient.users.findOne({ id: result.id });

	return {
		User: keycloakToCognitoUser(createdUser!),
	};
}

async function adminDeleteUser(request: AdminDeleteUserRequest): Promise<void> {
	await authenticate();
	requireUsername(request.Username);
	const user = await getRequiredUser(request.Username);
	await keycloakClient.users.del({ id: user.id! });
}

async function adminGetUser(
	request: AdminGetUserRequest,
): Promise<AdminGetUserResponse> {
	await authenticate();
	requireUsername(request.Username);
	const user = await getRequiredUser(request.Username);

	const createdTimestamp = user.createdTimestamp
		? new Date(user.createdTimestamp)
		: undefined;

	const lastModifiedDate = user.attributes?.lastModifiedDate?.[0]
		? new Date(user.attributes.lastModifiedDate[0])
		: createdTimestamp;

	return {
		Username: user.username,
		UserAttributes: keycloakToCognitoAttributes(user),
		UserCreateDate: createdTimestamp,
		UserLastModifiedDate: lastModifiedDate,
		Enabled: user.enabled,
		UserStatus: user.enabled ? "CONFIRMED" : "ARCHIVED",
	};
}

async function adminUpdateUserAttributes(
	request: AdminUpdateUserAttributesRequest,
): Promise<AdminUpdateUserAttributesResponse> {
	await authenticate();
	requireUsername(request.Username);
	const user = await getRequiredUser(request.Username);

	const { UserAttributes } = request;
	if (!UserAttributes) {
		return {};
	}

	const email = getAttributeValue(UserAttributes, "email");
	const firstName = getAttributeValue(UserAttributes, "given_name");
	const lastName = getAttributeValue(UserAttributes, "family_name");
	const emailVerified = getAttributeValue(UserAttributes, "email_verified");

	await keycloakClient.users.update(
		{ id: user.id! },
		{
			...(email !== undefined && { email }),
			...(firstName !== undefined && { firstName }),
			...(lastName !== undefined && { lastName }),
			...(emailVerified !== undefined && {
				emailVerified: emailVerified === "true",
			}),
			attributes: {
				...user.attributes,
				...cognitoToKeycloakAttributes(UserAttributes),
				lastModifiedDate: [new Date().toISOString()],
			},
		},
	);

	return {};
}

async function adminSetUserPassword(
	request: AdminSetUserPasswordRequest,
): Promise<AdminSetUserPasswordResponse> {
	await authenticate();
	requireUsername(request.Username);

	if (!request.Password) {
		throw new CognitoException(
			"InvalidParameterException",
			"1 validation error detected: Value at 'password' failed to satisfy constraint: Member must not be null",
			400,
		);
	}

	const user = await getRequiredUser(request.Username);
	await keycloakClient.users.resetPassword({
		id: user.id!,
		credential: {
			type: "password",
			value: request.Password,
			temporary: !request.Permanent,
		},
	});

	// Update lastModifiedDate
	await keycloakClient.users.update(
		{ id: user.id! },
		{
			attributes: {
				...user.attributes,
				lastModifiedDate: [new Date().toISOString()],
			},
		},
	);

	return {};
}

async function adminEnableUser(
	request: AdminEnableUserRequest,
): Promise<AdminEnableUserResponse> {
	await authenticate();
	requireUsername(request.Username);
	const user = await getRequiredUser(request.Username);
	await keycloakClient.users.update(
		{ id: user.id! },
		{
			enabled: true,
			attributes: {
				...user.attributes,
				lastModifiedDate: [new Date().toISOString()],
			},
		},
	);
	return {};
}

async function adminDisableUser(
	request: AdminDisableUserRequest,
): Promise<AdminDisableUserResponse> {
	await authenticate();
	requireUsername(request.Username);
	const user = await getRequiredUser(request.Username);
	await keycloakClient.users.update(
		{ id: user.id! },
		{
			enabled: false,
			attributes: {
				...user.attributes,
				lastModifiedDate: [new Date().toISOString()],
			},
		},
	);
	return {};
}

async function listUsers(
	request: ListUsersRequest,
): Promise<ListUsersResponse> {
	await authenticate();
	const { Limit, Filter, PaginationToken } = request;

	// Parse pagination token (simple offset-based)
	const offset = PaginationToken ? parseInt(PaginationToken, 10) : 0;
	const limit = Limit || 60;

	// Parse Cognito filter if provided
	// Cognito filter format: 'email = "test@example.com"' or 'username ^= "test"'
	const searchParams: {
		first?: number;
		max?: number;
		search?: string;
		email?: string;
		username?: string;
	} = {
		first: offset,
		max: limit,
	};

	if (Filter) {
		const emailMatch = Filter.match(/email\s*=\s*"([^"]+)"/);
		const usernameMatch = Filter.match(/username\s*(?:\^=|=)\s*"([^"]+)"/);

		if (emailMatch) {
			searchParams.email = emailMatch[1];
		}
		if (usernameMatch) {
			searchParams.search = usernameMatch[1];
		}
	}

	const users = await keycloakClient.users.find(searchParams);

	// Convert to Cognito format
	const cognitoUsers: UserType[] = users.map((user: UserRepresentation) =>
		keycloakToCognitoUser(user),
	);

	// Calculate next pagination token
	let nextToken: string | undefined;
	if (users.length === limit) {
		nextToken = (offset + limit).toString();
	}

	return {
		Users: cognitoUsers,
		PaginationToken: nextToken,
	};
}

// Export all handlers
export const userHandlers = {
	adminCreateUser,
	adminDeleteUser,
	adminGetUser,
	adminUpdateUserAttributes,
	adminSetUserPassword,
	adminEnableUser,
	adminDisableUser,
	listUsers,
};
