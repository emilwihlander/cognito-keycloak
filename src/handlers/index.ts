import type { Context } from "hono";
import { groupHandlers } from "./groups.js";
import { describeUserPool } from "./user-pool.js";
import { userHandlers } from "./users.js";

// Cognito-style exception for validation and known errors
export class CognitoException extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly httpStatusCode: number = 400,
	) {
		super(message);
		this.name = code;
	}
}

// Action handler type - accepts any JSON body and returns any response
// biome-ignore lint/suspicious/noExplicitAny: It is hard to type this correctly, not worth the effort
type ActionHandler = (body: any) => Promise<unknown>;

// Registry of all action handlers
const actionHandlers: Record<string, ActionHandler> = {
	// User management actions
	AdminCreateUser: userHandlers.adminCreateUser,
	AdminDeleteUser: userHandlers.adminDeleteUser,
	AdminGetUser: userHandlers.adminGetUser,
	AdminUpdateUserAttributes: userHandlers.adminUpdateUserAttributes,
	AdminSetUserPassword: userHandlers.adminSetUserPassword,
	AdminEnableUser: userHandlers.adminEnableUser,
	AdminDisableUser: userHandlers.adminDisableUser,
	ListUsers: userHandlers.listUsers,
	// Group management actions
	AdminListGroupsForUser: groupHandlers.adminListGroupsForUser,
	AdminAddUserToGroup: groupHandlers.adminAddUserToGroup,
	AdminRemoveUserFromGroup: groupHandlers.adminRemoveUserFromGroup,
	CreateGroup: groupHandlers.createGroup,
	DeleteGroup: groupHandlers.deleteGroup,
	GetGroup: groupHandlers.getGroup,
	ListGroups: groupHandlers.listGroups,
	ListUsersInGroup: groupHandlers.listUsersInGroup,
	UpdateGroup: groupHandlers.updateGroup,
	// User pool actions
	DescribeUserPool: describeUserPool,
};

// Extract action name from X-Amz-Target header
// Format: AWSCognitoIdentityProviderService.<ActionName>
function parseAmzTarget(header: string | undefined): string | null {
	if (!header) return null;

	const prefix = "AWSCognitoIdentityProviderService.";
	if (header.startsWith(prefix)) {
		return header.slice(prefix.length);
	}

	return null;
}

/**
 * The aws sdk expects dates to be in epoch seconds, while the default serialisation of dates is ISO 8601.
 * This function converts all dates recursively to epoch seconds to comply with the aws sdk.
 * @param value - The value to convert to epoch seconds.
 * @returns The value with all dates converted to epoch seconds.
 */
function convertDatesToEpochSeconds(value: unknown): unknown {
	if (value === null || value === undefined) {
		return value;
	}

	if (value instanceof Date) {
		return Math.floor(value.getTime() / 1000);
	}

	if (Array.isArray(value)) {
		return value.map(convertDatesToEpochSeconds);
	}

	if (typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value)) {
			result[key] = convertDatesToEpochSeconds(val);
		}
		return result;
	}

	return value;
}

/**
 * Create a Cognito-style error response
 * @param code - The error code.
 * @param message - The error message.
 * @returns The error response.
 */
function createErrorResponse(
	code: string,
	message: string,
): { __type: string; message: string } {
	return {
		__type: code,
		message,
	};
}

/**
 * Main action dispatcher for Cognito IDP API
 * Parses X-Amz-Target header and routes to appropriate handler
 */
export async function dispatchAction(c: Context): Promise<Response> {
	const amzTarget = c.req.header("X-Amz-Target");
	const action = parseAmzTarget(amzTarget);

	if (!action) {
		return c.json(
			createErrorResponse(
				"MissingAction",
				"Missing or invalid X-Amz-Target header",
			),
			400,
		);
	}

	const handler = actionHandlers[action];

	if (!handler) {
		return c.json(
			createErrorResponse("InvalidAction", `Action ${action} is not supported`),
			400,
		);
	}

	try {
		const body = await c.req.json();
		const result = await handler(body);
		return c.json(convertDatesToEpochSeconds(result));
	} catch (error) {
		console.error(`Error handling action ${action}:`, error);

		// Handle CognitoException (validation errors, known states)
		if (error instanceof CognitoException) {
			return c.json(
				createErrorResponse(error.code, error.message),
				error.httpStatusCode as 400 | 500,
			);
		}

		if (error instanceof Error) {
			return c.json(
				createErrorResponse("InternalErrorException", error.message),
				500,
			);
		}

		return c.json(
			createErrorResponse(
				"InternalErrorException",
				"An unknown error occurred",
			),
			500,
		);
	}
}

// Export list of supported actions for documentation/debugging
export function getSupportedActions(): string[] {
	return Object.keys(actionHandlers);
}
