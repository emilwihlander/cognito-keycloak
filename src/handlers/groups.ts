import type {
	AdminAddUserToGroupRequest,
	AdminListGroupsForUserRequest,
	AdminListGroupsForUserResponse,
	AdminRemoveUserFromGroupRequest,
	CreateGroupRequest,
	CreateGroupResponse,
	DeleteGroupRequest,
	GetGroupRequest,
	GetGroupResponse,
	GroupType,
	ListGroupsRequest,
	ListGroupsResponse,
	ListUsersInGroupRequest,
	ListUsersInGroupResponse,
	UpdateGroupRequest,
	UpdateGroupResponse,
	UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import type GroupRepresentation from "@keycloak/keycloak-admin-client/lib/defs/groupRepresentation.js";
import type UserRepresentation from "@keycloak/keycloak-admin-client/lib/defs/userRepresentation.js";
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
	const attributes = group.attributes || {};
	return {
		GroupName: group.name,
		Description: attributes.description?.[0],
		Precedence: attributes.precedence?.[0]
			? parseInt(attributes.precedence[0], 10)
			: undefined,
		RoleArn: attributes.roleArn?.[0],
		// Keycloak groups don't have creation dates exposed in the same way
		CreationDate: new Date(),
		LastModifiedDate: new Date(),
	};
}

/**
 * Convert Keycloak user to Cognito UserType (for ListUsersInGroup)
 */
function keycloakToCognitoUser(user: UserRepresentation): UserType {
	type UserStatusType =
		| "ARCHIVED"
		| "COMPROMISED"
		| "CONFIRMED"
		| "EXTERNAL_PROVIDER"
		| "FORCE_CHANGE_PASSWORD"
		| "RESET_REQUIRED"
		| "UNCONFIRMED"
		| "UNKNOWN";

	let userStatus: UserStatusType;
	if (!user.enabled) {
		userStatus = "ARCHIVED";
	} else if (user.requiredActions?.includes("UPDATE_PASSWORD")) {
		userStatus = "FORCE_CHANGE_PASSWORD";
	} else {
		userStatus = "CONFIRMED";
	}

	const createdTimestamp = user.createdTimestamp
		? new Date(user.createdTimestamp)
		: undefined;

	// Build attributes
	const attributes: { Name: string; Value: string }[] = [];
	if (user.email) {
		attributes.push({ Name: "email", Value: user.email });
	}
	if (user.emailVerified !== undefined) {
		attributes.push({
			Name: "email_verified",
			Value: user.emailVerified.toString(),
		});
	}
	if (user.firstName) {
		attributes.push({ Name: "given_name", Value: user.firstName });
	}
	if (user.lastName) {
		attributes.push({ Name: "family_name", Value: user.lastName });
	}
	if (user.id) {
		attributes.push({ Name: "sub", Value: user.id });
	}

	return {
		Username: user.username,
		Attributes: attributes,
		UserCreateDate: createdTimestamp,
		UserLastModifiedDate: createdTimestamp,
		Enabled: user.enabled,
		UserStatus: userStatus,
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

	// Fetch full group details to get attributes (description, precedence, roleArn)
	const fullGroups = await Promise.all(
		paginatedGroups.map(async (group) => {
			if (!group.id) return group;
			const fullGroup = await keycloakClient.groups.findOne({ id: group.id });
			return fullGroup ?? group;
		}),
	);

	const cognitoGroups: GroupType[] = fullGroups.map((group) =>
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

async function createGroup(
	request: CreateGroupRequest,
): Promise<CreateGroupResponse> {
	await authenticate();
	requireGroupName(request.GroupName);

	// Check if group already exists
	const existingGroups = await keycloakClient.groups.find({
		search: request.GroupName,
	});
	const existingGroup = existingGroups.find(
		(g) => g.name === request.GroupName,
	);
	if (existingGroup) {
		throw new CognitoException(
			"GroupExistsException",
			"A group with the name already exists in the user pool.",
			400,
		);
	}

	// Build group attributes for Keycloak
	const attributes: Record<string, string[]> = {};
	if (request.Description) {
		attributes.description = [request.Description];
	}
	if (request.Precedence !== undefined) {
		attributes.precedence = [request.Precedence.toString()];
	}
	if (request.RoleArn) {
		attributes.roleArn = [request.RoleArn];
	}

	const result = await keycloakClient.groups.create({
		name: request.GroupName,
		attributes,
	});

	// Fetch the created group to return full details
	const createdGroup = await keycloakClient.groups.findOne({ id: result.id });

	return {
		Group: createdGroup ? keycloakToCognitoGroup(createdGroup) : undefined,
	};
}

async function deleteGroup(request: DeleteGroupRequest): Promise<void> {
	await authenticate();
	requireGroupName(request.GroupName);

	const group = await getRequiredGroup(request.GroupName);
	await keycloakClient.groups.del({ id: group.id });
}

async function getGroup(request: GetGroupRequest): Promise<GetGroupResponse> {
	await authenticate();
	requireGroupName(request.GroupName);

	const groups = await keycloakClient.groups.find({
		search: request.GroupName,
	});
	const group = groups.find((g) => g.name === request.GroupName);

	if (!group || !group.id) {
		throw new CognitoException(
			"ResourceNotFoundException",
			"Group not found.",
			400,
		);
	}

	// Get full group details including attributes
	const fullGroup = await keycloakClient.groups.findOne({ id: group.id });

	return {
		Group: fullGroup ? keycloakToCognitoGroup(fullGroup) : undefined,
	};
}

async function listGroups(
	request: ListGroupsRequest,
): Promise<ListGroupsResponse> {
	await authenticate();

	const limit = request.Limit || 60;
	const offset = request.NextToken ? parseInt(request.NextToken, 10) : 0;

	// Keycloak uses first/max for pagination
	const groups = await keycloakClient.groups.find({
		first: offset,
		max: limit,
	});

	const cognitoGroups: GroupType[] = groups.map((group) =>
		keycloakToCognitoGroup(group),
	);

	// Calculate next token
	let nextToken: string | undefined;
	if (groups.length === limit) {
		nextToken = (offset + limit).toString();
	}

	return {
		Groups: cognitoGroups,
		NextToken: nextToken,
	};
}

async function listUsersInGroup(
	request: ListUsersInGroupRequest,
): Promise<ListUsersInGroupResponse> {
	await authenticate();
	requireGroupName(request.GroupName);

	const group = await getRequiredGroup(request.GroupName);

	const limit = request.Limit || 60;
	const offset = request.NextToken ? parseInt(request.NextToken, 10) : 0;

	// Get group members from Keycloak
	const members = await keycloakClient.groups.listMembers({
		id: group.id,
		first: offset,
		max: limit,
	});

	const cognitoUsers: UserType[] = members.map((user) =>
		keycloakToCognitoUser(user),
	);

	// Calculate next token
	let nextToken: string | undefined;
	if (members.length === limit) {
		nextToken = (offset + limit).toString();
	}

	return {
		Users: cognitoUsers,
		NextToken: nextToken,
	};
}

async function updateGroup(
	request: UpdateGroupRequest,
): Promise<UpdateGroupResponse> {
	await authenticate();
	requireGroupName(request.GroupName);

	const group = await getRequiredGroup(request.GroupName);

	// Get existing group to preserve unchanged attributes
	const existingGroup = await keycloakClient.groups.findOne({ id: group.id });
	const existingAttributes = existingGroup?.attributes || {};

	// Build updated attributes
	const attributes: Record<string, string[]> = { ...existingAttributes };

	if (request.Description !== undefined) {
		if (request.Description) {
			attributes.description = [request.Description];
		} else {
			delete attributes.description;
		}
	}
	if (request.Precedence !== undefined) {
		attributes.precedence = [request.Precedence.toString()];
	}
	if (request.RoleArn !== undefined) {
		if (request.RoleArn) {
			attributes.roleArn = [request.RoleArn];
		} else {
			delete attributes.roleArn;
		}
	}

	await keycloakClient.groups.update(
		{ id: group.id },
		{
			name: group.name,
			attributes,
		},
	);

	// Fetch updated group
	const updatedGroup = await keycloakClient.groups.findOne({ id: group.id });

	return {
		Group: updatedGroup ? keycloakToCognitoGroup(updatedGroup) : undefined,
	};
}

// Export all handlers
export const groupHandlers = {
	adminListGroupsForUser,
	adminAddUserToGroup,
	adminRemoveUserFromGroup,
	createGroup,
	deleteGroup,
	getGroup,
	listGroups,
	listUsersInGroup,
	updateGroup,
};
