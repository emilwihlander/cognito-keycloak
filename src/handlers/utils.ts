import type {
	AttributeType,
	GroupType,
	UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import type GroupRepresentation from "@keycloak/keycloak-admin-client/lib/defs/groupRepresentation.js";
import type UserRepresentation from "@keycloak/keycloak-admin-client/lib/defs/userRepresentation.js";
import { keycloakClient } from "../keycloak/client.js";
import { CognitoException } from "./index.js";

// ============ Validation Functions ============

/**
 * Validate that username is provided, throw CognitoException if not
 */
export function requireUsername(
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
export function requireGroupName(
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

// ============ Lookup Functions ============

/**
 * Find a user by username in Keycloak, throw UserNotFoundException if not found
 */
export async function getRequiredUser(
	username: string,
): Promise<UserRepresentation> {
	const users = await keycloakClient.users.find({ exact: true, username });
	const user = users.at(0);
	if (!user || !user.id) {
		throw new CognitoException(
			"UserNotFoundException",
			"User does not exist.",
			400,
		);
	}
	return user;
}

/**
 * Find a group by name in Keycloak, throw ResourceNotFoundException if not found
 */
export async function getRequiredGroup(
	groupName: string,
): Promise<GroupRepresentation> {
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
	return group;
}

// ============ Attribute Conversion Functions ============

/**
 * Convert Cognito AttributeType[] to Keycloak attributes format
 * Cognito: [{ Name: "email", Value: "test@example.com" }]
 * Keycloak: { email: ["test@example.com"] }
 */
export function cognitoToKeycloakAttributes(
	attributes?: AttributeType[],
): Record<string, string[]> {
	if (!attributes) return {};

	const result: Record<string, string[]> = {};

	for (const attr of attributes) {
		if (attr.Name && attr.Value !== undefined) {
			// Handle standard attributes that map directly
			const name = attr.Name.replace(/^custom:/, "");
			result[name] = [attr.Value];
		}
	}

	return result;
}

/**
 * Convert Keycloak user to Cognito AttributeType[]
 */
export function keycloakToCognitoAttributes(
	user: UserRepresentation,
): AttributeType[] {
	const attributes: AttributeType[] = [];

	// Map standard fields
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

	// Add sub (user ID)
	if (user.id) {
		attributes.push({ Name: "sub", Value: user.id });
	}

	// Map custom attributes from Keycloak
	if (user.attributes) {
		for (const [key, values] of Object.entries(user.attributes)) {
			if (values && values.length > 0) {
				// Skip attributes we've already mapped
				if (!["email", "firstName", "lastName"].includes(key)) {
					attributes.push({ Name: `custom:${key}`, Value: values[0] });
				}
			}
		}
	}

	return attributes;
}

/**
 * Extract specific attribute value from Cognito attributes
 */
export function getAttributeValue(
	attributes: AttributeType[] | undefined,
	name: string,
): string | undefined {
	return attributes?.find((a) => a.Name === name)?.Value;
}

// ============ Entity Conversion Functions ============

/**
 * Cognito UserStatusType
 */
type UserStatusType =
	| "ARCHIVED"
	| "COMPROMISED"
	| "CONFIRMED"
	| "EXTERNAL_PROVIDER"
	| "FORCE_CHANGE_PASSWORD"
	| "RESET_REQUIRED"
	| "UNCONFIRMED"
	| "UNKNOWN";

/**
 * Convert Keycloak user to Cognito UserType
 */
export function keycloakToCognitoUser(user: UserRepresentation): UserType {
	// Determine user status based on Keycloak state
	// - If disabled → ARCHIVED
	// - If has UPDATE_PASSWORD required action → FORCE_CHANGE_PASSWORD (temporary password)
	// - Otherwise → CONFIRMED
	let userStatus: UserStatusType;
	if (!user.enabled) {
		userStatus = "ARCHIVED";
	} else if (user.requiredActions?.includes("UPDATE_PASSWORD")) {
		userStatus = "FORCE_CHANGE_PASSWORD";
	} else {
		userStatus = "CONFIRMED";
	}

	// Keycloak provides createdTimestamp natively
	const createdTimestamp = user.createdTimestamp
		? new Date(user.createdTimestamp)
		: undefined;

	// lastModifiedDate is stored as a custom attribute
	const lastModifiedDate = user.attributes?.lastModifiedDate?.[0]
		? new Date(user.attributes.lastModifiedDate[0])
		: createdTimestamp;

	return {
		Username: user.username ?? user.id,
		Attributes: keycloakToCognitoAttributes(user),
		UserCreateDate: createdTimestamp,
		UserLastModifiedDate: lastModifiedDate,
		Enabled: user.enabled,
		UserStatus: userStatus,
	};
}

/**
 * Convert Keycloak group to Cognito GroupType
 */
export function keycloakToCognitoGroup(group: GroupRepresentation): GroupType {
	const attributes = group.attributes || {};

	// Parse dates from attributes (stored as ISO strings)
	const creationDate = attributes.creationDate?.[0]
		? new Date(attributes.creationDate[0])
		: new Date();
	const lastModifiedDate = attributes.lastModifiedDate?.[0]
		? new Date(attributes.lastModifiedDate[0])
		: creationDate;

	return {
		GroupName: group.name,
		Description: attributes.description?.[0],
		Precedence: attributes.precedence?.[0]
			? parseInt(attributes.precedence[0], 10)
			: undefined,
		RoleArn: attributes.roleArn?.[0],
		CreationDate: creationDate,
		LastModifiedDate: lastModifiedDate,
	};
}
