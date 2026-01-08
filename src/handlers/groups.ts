import type {
	AdminAddUserToGroupRequest,
	AdminListGroupsForUserRequest,
	AdminListGroupsForUserResponse,
	AdminRemoveUserFromGroupRequest,
	GroupType,
} from "@aws-sdk/client-cognito-identity-provider";
import type GroupRepresentation from "@keycloak/keycloak-admin-client/lib/defs/groupRepresentation.js";
import { authenticate, keycloakClient } from "../keycloak/client.js";
import { CognitoException } from "./index.js";

// ============ Utility Functions ============

/**
 * Validate that username is provided, throw CognitoException if not
 */
function requireUsername(
	username: string | undefined,
): asserts username is string {
	if (!username) {
		throw new CognitoException(
			"InvalidParameterException",
			"1 validation error detected: Value at 'username' failed to satisfy constraint: Member must not be null",
			400,
		);
	}
}

/**
 * Validate that group name is provided, throw CognitoException if not
 */
function requireGroupName(
	groupName: string | undefined,
): asserts groupName is string {
	if (!groupName) {
		throw new CognitoException(
			"InvalidParameterException",
			"1 validation error detected: Value at 'groupName' failed to satisfy constraint: Member must not be null",
			400,
		);
	}
}

/**
 * Find a user by username in Keycloak, throw UserNotFoundException if not found
 */
async function getRequiredUser(
	username: string,
): Promise<{ id: string; username: string }> {
	const users = await keycloakClient.users.find({ exact: true, username });
	const user = users.at(0);
	if (!user || !user.id) {
		throw new CognitoException(
			"UserNotFoundException",
			"User does not exist.",
			400,
		);
	}
	return { id: user.id, username: user.username! };
}

/**
 * Find a group by name in Keycloak, throw ResourceNotFoundException if not found
 */
async function getRequiredGroup(
	groupName: string,
): Promise<{ id: string; name: string }> {
	const groups = await keycloakClient.groups.find({ search: groupName });
	// Find exact match (search is partial match)
	const group = groups.find((g) => g.name === groupName);
	if (!group || !group.id) {
		throw new CognitoException(
			"ResourceNotFoundException",
			"Group not found.",
			400,
		);
	}
	return { id: group.id, name: group.name! };
}

/**
 * Convert Keycloak group to Cognito GroupType
 */
function keycloakToCognitoGroup(group: GroupRepresentation): GroupType {
	return {
		GroupName: group.name,
		// Keycloak groups don't have creation dates exposed in the same way
		CreationDate: new Date(),
		LastModifiedDate: new Date(),
	};
}

// ============ Group Action Handlers ============

async function adminListGroupsForUser(
	request: AdminListGroupsForUserRequest,
): Promise<AdminListGroupsForUserResponse> {
	await authenticate();
	requireUsername(request.Username);

	const user = await getRequiredUser(request.Username);
	const groups = await keycloakClient.users.listGroups({ id: user.id });

	// Handle pagination
	const limit = request.Limit || 60;
	const offset = request.NextToken ? parseInt(request.NextToken, 10) : 0;

	const paginatedGroups = groups.slice(offset, offset + limit);
	const cognitoGroups: GroupType[] = paginatedGroups.map((group) =>
		keycloakToCognitoGroup(group),
	);

	// Calculate next token
	let nextToken: string | undefined;
	if (offset + limit < groups.length) {
		nextToken = (offset + limit).toString();
	}

	return {
		Groups: cognitoGroups,
		NextToken: nextToken,
	};
}

async function adminAddUserToGroup(
	request: AdminAddUserToGroupRequest,
): Promise<void> {
	await authenticate();
	requireUsername(request.Username);
	requireGroupName(request.GroupName);

	const user = await getRequiredUser(request.Username);
	const group = await getRequiredGroup(request.GroupName);

	await keycloakClient.users.addToGroup({
		id: user.id,
		groupId: group.id,
	});
}

async function adminRemoveUserFromGroup(
	request: AdminRemoveUserFromGroupRequest,
): Promise<void> {
	await authenticate();
	requireUsername(request.Username);
	requireGroupName(request.GroupName);

	const user = await getRequiredUser(request.Username);
	const group = await getRequiredGroup(request.GroupName);

	await keycloakClient.users.delFromGroup({
		id: user.id,
		groupId: group.id,
	});
}

// Export all handlers
export const groupHandlers = {
	adminListGroupsForUser,
	adminAddUserToGroup,
	adminRemoveUserFromGroup,
};
