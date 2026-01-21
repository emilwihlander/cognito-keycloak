import type {
	AdminConfirmSignUpRequest,
	AdminConfirmSignUpResponse,
	AdminCreateUserRequest,
	AdminCreateUserResponse,
	AdminDeleteUserAttributesRequest,
	AdminDeleteUserAttributesResponse,
	AdminDeleteUserRequest,
	AdminDisableUserRequest,
	AdminDisableUserResponse,
	AdminEnableUserRequest,
	AdminEnableUserResponse,
	AdminGetUserRequest,
	AdminGetUserResponse,
	AdminResetUserPasswordRequest,
	AdminResetUserPasswordResponse,
	AdminSetUserPasswordRequest,
	AdminSetUserPasswordResponse,
	AdminUpdateUserAttributesRequest,
	AdminUpdateUserAttributesResponse,
	AdminUserGlobalSignOutRequest,
	AdminUserGlobalSignOutResponse,
	ListUsersRequest,
	ListUsersResponse,
	UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import { NetworkError } from "@keycloak/keycloak-admin-client";
import type UserRepresentation from "@keycloak/keycloak-admin-client/lib/defs/userRepresentation.js";
import { authenticate, keycloakClient } from "../keycloak/client.js";
import { CognitoException } from "./index.js";
import {
	cognitoToKeycloakAttributes,
	getAttributeValue,
	getRequiredUser,
	getSchemaAttributeMap,
	keycloakToCognitoAttributes,
	keycloakToCognitoUser,
	requireUsername,
	validateAttributeDeletable,
	validateAttributeMutable,
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
	try {
		const body = {
			username: Username,
			email,
			firstName,
			lastName,
			enabled: true,
			emailVerified:
				emailVerifiedAttr === "true" || MessageAction === "SUPPRESS",
			attributes: {
				...cognitoToKeycloakAttributes(UserAttributes),
				lastModifiedDate: [now],
			},
			// Always set UPDATE_PASSWORD required action to map to Cognito's FORCE_CHANGE_PASSWORD
			// status, ensuring users must set their own password on first login (security best practice).
			requiredActions: ["UPDATE_PASSWORD"],
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
		const result = await keycloakClient.users.create(body);

		// Fetch the created user to return full details
		const createdUser = await keycloakClient.users.findOne({ id: result.id });

		return {
			User: keycloakToCognitoUser(createdUser!),
		};
	} catch (error) {
		if (error instanceof NetworkError && error.response.status === 409) {
			throw new CognitoException(
				"UsernameExistsException",
				"An account with the given username already exists.",
				400,
			);
		}
		throw error;
	}
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

	// Determine user status based on Keycloak state
	// - If disabled → ARCHIVED
	// - If has UPDATE_PASSWORD required action → FORCE_CHANGE_PASSWORD
	// - Otherwise → CONFIRMED
	let userStatus: "ARCHIVED" | "FORCE_CHANGE_PASSWORD" | "CONFIRMED";
	if (!user.enabled) {
		userStatus = "ARCHIVED";
	} else if (user.requiredActions?.includes("UPDATE_PASSWORD")) {
		userStatus = "FORCE_CHANGE_PASSWORD";
	} else {
		userStatus = "CONFIRMED";
	}

	return {
		Username: user.username,
		UserAttributes: keycloakToCognitoAttributes(user),
		UserCreateDate: createdTimestamp,
		UserLastModifiedDate: lastModifiedDate,
		Enabled: user.enabled,
		UserStatus: userStatus,
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

	const schemaMap = getSchemaAttributeMap();

	for (const attr of UserAttributes) {
		if (!attr.Name) continue;
		validateAttributeMutable(attr.Name, schemaMap);
	}

	const email = getAttributeValue(UserAttributes, "email");
	const firstName = getAttributeValue(UserAttributes, "given_name");
	const lastName = getAttributeValue(UserAttributes, "family_name");
	const emailVerified = getAttributeValue(UserAttributes, "email_verified");

	await keycloakClient.users.update(
		{ id: user.id! },
		{
			...user,
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

	const updatedUser = await getRequiredUser(request.Username);

	// Update lastModifiedDate
	await keycloakClient.users.update(
		{ id: user.id! },
		{
			...updatedUser,
			attributes: {
				...updatedUser.attributes,
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
			...user,
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
			...user,
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

async function adminDeleteUserAttributes(
	request: AdminDeleteUserAttributesRequest,
): Promise<AdminDeleteUserAttributesResponse> {
	await authenticate();
	requireUsername(request.Username);
	const user = await getRequiredUser(request.Username);

	const { UserAttributeNames } = request;
	if (!UserAttributeNames || UserAttributeNames.length === 0) {
		return {};
	}

	const schemaMap = getSchemaAttributeMap();

	// Build updated user payload
	const updatePayload: {
		email?: string;
		firstName?: string;
		lastName?: string;
		emailVerified?: boolean;
		attributes?: Record<string, string[]>;
	} = {};

	for (const attrName of UserAttributeNames) {
		validateAttributeMutable(attrName, schemaMap);
		validateAttributeDeletable(attrName, schemaMap);
	}

	// Handle standard attributes that need to be cleared
	for (const attrName of UserAttributeNames) {
		switch (attrName) {
			case "email":
				updatePayload.email = "";
				break;
			case "given_name":
				updatePayload.firstName = "";
				break;
			case "family_name":
				updatePayload.lastName = "";
				break;
			case "email_verified":
				updatePayload.emailVerified = false;
				break;
		}
	}

	// Handle custom attributes - remove them from the attributes object
	const currentAttributes = { ...(user.attributes || {}) };
	for (const attrName of UserAttributeNames) {
		// Remove custom: prefix if present
		const keyName = attrName.replace(/^custom:/, "");
		// Delete the attribute if it exists
		delete currentAttributes[keyName];
	}

	// Update lastModifiedDate
	currentAttributes.lastModifiedDate = [new Date().toISOString()];
	updatePayload.attributes = currentAttributes;

	await keycloakClient.users.update({ id: user.id! }, updatePayload);

	return {};
}

async function adminConfirmSignUp(
	request: AdminConfirmSignUpRequest,
): Promise<AdminConfirmSignUpResponse> {
	await authenticate();
	requireUsername(request.Username);
	const user = await getRequiredUser(request.Username);

	// Confirm signup by:
	// 1. Setting emailVerified to true
	// 2. Removing any VERIFY_EMAIL required action
	const requiredActions = (user.requiredActions || []).filter(
		(action) => action !== "VERIFY_EMAIL",
	);

	await keycloakClient.users.update(
		{ id: user.id! },
		{
			...user,
			emailVerified: true,
			requiredActions,
			attributes: {
				...user.attributes,
				lastModifiedDate: [new Date().toISOString()],
			},
		},
	);

	return {};
}

async function adminResetUserPassword(
	request: AdminResetUserPasswordRequest,
): Promise<AdminResetUserPasswordResponse> {
	await authenticate();
	requireUsername(request.Username);
	const user = await getRequiredUser(request.Username);

	// Build new required actions array with UPDATE_PASSWORD
	// This puts the user in RESET_REQUIRED/FORCE_CHANGE_PASSWORD state
	const currentActions = user.requiredActions || [];
	const requiredActions = currentActions.includes("UPDATE_PASSWORD")
		? currentActions
		: [...currentActions, "UPDATE_PASSWORD"];

	// Update user to have UPDATE_PASSWORD required action
	await keycloakClient.users.update(
		{ id: user.id! },
		{
			...user,
			requiredActions,
			attributes: {
				...user.attributes,
				lastModifiedDate: [new Date().toISOString()],
			},
		},
	);

	// Try to send the password reset email if user has a verified email
	// This may fail if email is not configured in Keycloak - that's OK
	if (user.email && user.emailVerified) {
		try {
			await keycloakClient.users.executeActionsEmail({
				id: user.id!,
				actions: ["UPDATE_PASSWORD"],
			});
		} catch {
			// Email sending failed (e.g., SMTP not configured) - this is acceptable
			// The user is already in RESET_REQUIRED state
		}
	}

	return {};
}

async function adminUserGlobalSignOut(
	request: AdminUserGlobalSignOutRequest,
): Promise<AdminUserGlobalSignOutResponse> {
	await authenticate();
	requireUsername(request.Username);
	const user = await getRequiredUser(request.Username);

	// Logout user from all sessions
	await keycloakClient.users.logout({ id: user.id! });

	return {};
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
	adminDeleteUserAttributes,
	adminConfirmSignUp,
	adminResetUserPassword,
	adminUserGlobalSignOut,
};
