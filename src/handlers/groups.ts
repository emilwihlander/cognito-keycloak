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
import { authenticate, keycloakClient } from "../keycloak/client.js";
import { CognitoException } from "./index.js";
import {
	getRequiredGroup,
	getRequiredUser,
	keycloakToCognitoGroup,
	keycloakToCognitoUser,
	requireGroupName,
	requireUsername,
} from "./utils.js";

// ============ Group Action Handlers ============

async function adminListGroupsForUser(
	request: AdminListGroupsForUserRequest,
): Promise<AdminListGroupsForUserResponse> {
	await authenticate();
	requireUsername(request.Username);

	const user = await getRequiredUser(request.Username);
	const groups = await keycloakClient.users.listGroups({ id: user.id! });

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
		id: user.id!,
		groupId: group.id!,
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
		id: user.id!,
		groupId: group.id!,
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
	const now = new Date().toISOString();
	const attributes: Record<string, string[]> = {
		creationDate: [now],
		lastModifiedDate: [now],
	};
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

	// Validate that we got a valid group ID back from Keycloak
	if (!result.id) {
		throw new CognitoException(
			"InternalErrorException",
			"Failed to create group",
			500,
		);
	}

	// Fetch the created group to return full details
	const createdGroup = await keycloakClient.groups.findOne({ id: result.id });
	if (!createdGroup) {
		throw new CognitoException(
			"InternalErrorException",
			"Failed to retrieve created group",
			500,
		);
	}

	return {
		Group: keycloakToCognitoGroup(createdGroup),
	};
}

async function deleteGroup(request: DeleteGroupRequest): Promise<void> {
	await authenticate();
	requireGroupName(request.GroupName);

	const group = await getRequiredGroup(request.GroupName);
	await keycloakClient.groups.del({ id: group.id! });
}

async function getGroup(request: GetGroupRequest): Promise<GetGroupResponse> {
	await authenticate();
	requireGroupName(request.GroupName);

	const group = await getRequiredGroup(request.GroupName);

	// Get full group details including attributes
	const fullGroup = await keycloakClient.groups.findOne({ id: group.id! });

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
		id: group.id!,
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
	const existingGroup = await keycloakClient.groups.findOne({ id: group.id! });
	const existingAttributes = existingGroup?.attributes || {};

	// Build updated attributes
	const attributes: Record<string, string[]> = { ...existingAttributes };

	// Update lastModifiedDate
	attributes.lastModifiedDate = [new Date().toISOString()];

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
		{ id: group.id! },
		{
			name: group.name,
			attributes,
		},
	);

	// Fetch updated group
	const updatedGroup = await keycloakClient.groups.findOne({ id: group.id! });

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
