import type {
  AdminCreateUserRequest,
  AdminCreateUserResponse,
  AdminDeleteUserRequest,
  AdminGetUserRequest,
  AdminUpdateUserAttributesRequest,
  AdminUpdateUserAttributesResponse,
  AdminSetUserPasswordRequest,
  AdminSetUserPasswordResponse,
  AdminEnableUserRequest,
  AdminEnableUserResponse,
  AdminDisableUserRequest,
  AdminDisableUserResponse,
  ListUsersRequest,
  ListUsersResponse,
  UserType,
  AttributeType,
  AdminGetUserResponse,
} from "@aws-sdk/client-cognito-identity-provider";
import { CognitoException } from "./index.js";
import { authenticate, keycloakClient } from "../keycloak/client.js";
import UserRepresentation from "@keycloak/keycloak-admin-client/lib/defs/userRepresentation.js";

// ============ Utility Functions ============

/**
 * Convert Cognito AttributeType[] to Keycloak attributes format
 * Cognito: [{ Name: "email", Value: "test@example.com" }]
 * Keycloak: { email: ["test@example.com"] }
 */
function cognitoToKeycloakAttributes(
  attributes?: AttributeType[]
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
function keycloakToCognitoAttributes(user: UserRepresentation): AttributeType[] {
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
  attributes.push({ Name: "sub", Value: user.id });

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
 * Convert Keycloak user to Cognito UserType
 * Note: Cognito API returns dates as epoch seconds (numbers)
 */
function keycloakToCognitoUser(user: UserRepresentation): UserType {
  // Cognito UserStatusType: ARCHIVED | COMPROMISED | CONFIRMED | EXTERNAL_PROVIDER | FORCE_CHANGE_PASSWORD | RESET_REQUIRED | UNCONFIRMED | UNKNOWN
  type UserStatusType = "ARCHIVED" | "COMPROMISED" | "CONFIRMED" | "EXTERNAL_PROVIDER" | "FORCE_CHANGE_PASSWORD" | "RESET_REQUIRED" | "UNCONFIRMED" | "UNKNOWN";
  
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

  const createdTimestamp = user.createdTimestamp ? new Date(user.createdTimestamp) : undefined;

  return {
    Username: user.username,
    Attributes: keycloakToCognitoAttributes(user),
    UserCreateDate: createdTimestamp,
    UserLastModifiedDate: createdTimestamp,
    Enabled: user.enabled,
    UserStatus: userStatus,
  };
}

/**
 * Extract specific attribute value from Cognito attributes
 */
function getAttributeValue(
  attributes: AttributeType[] | undefined,
  name: string
): string | undefined {
  return attributes?.find((a) => a.Name === name)?.Value;
}

/**
 * Validate that username is provided, throw CognitoException if not
 */
function requireUsername(username: string | undefined): asserts username is string {
  if (!username) {
    throw new CognitoException(
      "InvalidParameterException",
      "1 validation error detected: Value at 'username' failed to satisfy constraint: Member must not be null",
      400
    );
  }
}

/**
 * Find a user by username in Keycloak, throw UserNotFoundException if not found
 */
async function getRequiredUser(username: string): Promise<UserRepresentation> {
  const users = await keycloakClient.users.find({ exact: true, username });
  const user = users.at(0);
  if (!user) {
    throw new CognitoException("UserNotFoundException", "User does not exist.", 400);
  }
  return user;
}

// ============ User Action Handlers ============

async function adminCreateUser(
  request: AdminCreateUserRequest
): Promise<AdminCreateUserResponse> {
  await authenticate();
  const { Username, UserAttributes, TemporaryPassword, MessageAction } = request;
  requireUsername(Username);

  // Extract email, name, and email_verified from attributes
  const email = getAttributeValue(UserAttributes, "email");
  const firstName = getAttributeValue(UserAttributes, "given_name");
  const lastName = getAttributeValue(UserAttributes, "family_name");
  const emailVerifiedAttr = getAttributeValue(UserAttributes, "email_verified");

  // Build Keycloak user payload
  const keycloakPayload = {
    username: Username,
    email,
    firstName,
    lastName,
    enabled: true,
    emailVerified: emailVerifiedAttr === "true" || MessageAction === "SUPPRESS",
    attributes: cognitoToKeycloakAttributes(UserAttributes),
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
      500
    );
  }

  // Fetch the created user to return full details
  // Keycloak will have set requiredActions: ["UPDATE_PASSWORD"] if temporary password was used
  const createdUser = await keycloakClient.users.findOne({ id: result.id });

  return {
    User: keycloakToCognitoUser(createdUser!),
  };
}

async function adminDeleteUser(
  request: AdminDeleteUserRequest
): Promise<void> {
  await authenticate();
  requireUsername(request.Username);
  const user = await getRequiredUser(request.Username);
  await keycloakClient.users.del({ id: user.id! });
}

async function adminGetUser(
  request: AdminGetUserRequest
): Promise<AdminGetUserResponse> {
  await authenticate();
  requireUsername(request.Username);
  const user = await getRequiredUser(request.Username);

  return {
    Username: user.username,
    UserAttributes: keycloakToCognitoAttributes(user),
    UserCreateDate: user.createdTimestamp ? new Date(user.createdTimestamp) : new Date(),
    UserLastModifiedDate: user.createdTimestamp ? new Date(user.createdTimestamp) : new Date(),
    Enabled: user.enabled,
    UserStatus: user.enabled ? "CONFIRMED" : "ARCHIVED",
  };
}

async function adminUpdateUserAttributes(
  request: AdminUpdateUserAttributesRequest
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

  await keycloakClient.users.update({ id: user.id! }, {
    ...(email !== undefined && { email }),
    ...(firstName !== undefined && { firstName }),
    ...(lastName !== undefined && { lastName }),
    ...(emailVerified !== undefined && { emailVerified: emailVerified === "true" }),
    attributes: { ...user.attributes, ...cognitoToKeycloakAttributes(UserAttributes) },
  });

  return {};
}

async function adminSetUserPassword(
  request: AdminSetUserPasswordRequest
): Promise<AdminSetUserPasswordResponse> {
  await authenticate();
  requireUsername(request.Username);
  
  if (!request.Password) {
    throw new CognitoException(
      "InvalidParameterException",
      "1 validation error detected: Value at 'password' failed to satisfy constraint: Member must not be null",
      400
    );
  }

  const user = await getRequiredUser(request.Username);
  await keycloakClient.users.resetPassword({
    id: user.id!,
    credential: { type: "password", value: request.Password, temporary: !request.Permanent },
  });
  return {};
}

async function adminEnableUser(
  request: AdminEnableUserRequest
): Promise<AdminEnableUserResponse> {
  await authenticate();
  requireUsername(request.Username);
  const user = await getRequiredUser(request.Username);
  await keycloakClient.users.update({ id: user.id! }, { enabled: true });
  return {};
}

async function adminDisableUser(
  request: AdminDisableUserRequest
): Promise<AdminDisableUserResponse> {
  await authenticate();
  requireUsername(request.Username);
  const user = await getRequiredUser(request.Username);
  await keycloakClient.users.update({ id: user.id! }, { enabled: false });
  return {};
}

async function listUsers(request: ListUsersRequest): Promise<ListUsersResponse> {
  await authenticate();
  const { Limit, Filter, PaginationToken } = request;

  // Parse pagination token (simple offset-based)
  const offset = PaginationToken ? parseInt(PaginationToken, 10) : 0;
  const limit = Limit || 60;

  // Parse Cognito filter if provided
  // Cognito filter format: 'email = "test@example.com"' or 'username ^= "test"'
  let searchParams: {
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
  const cognitoUsers: UserType[] = users.map((user: UserRepresentation) => keycloakToCognitoUser(user));

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

