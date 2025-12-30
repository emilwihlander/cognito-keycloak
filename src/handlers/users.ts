import type {
  AdminCreateUserRequest,
  AdminCreateUserResponse,
  AdminDeleteUserRequest,
  AdminGetUserRequest,
  AdminGetUserResponse,
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
} from "@aws-sdk/client-cognito-identity-provider";
import {
  keycloakClient,
  KeycloakError,
  type KeycloakUser,
} from "../keycloak/client.js";
import { config } from "../config.js";

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
function keycloakToCognitoAttributes(user: KeycloakUser): AttributeType[] {
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
 * Convert timestamp to epoch seconds for Cognito API
 */
function toEpochSeconds(timestamp?: number): Date {
  // AWS SDK expects Date objects but serializes them as epoch seconds
  // We need to return a Date that will serialize correctly
  if (timestamp) {
    return new Date(timestamp);
  }
  return new Date();
}

/**
 * Convert Keycloak user to Cognito UserType
 * Note: Cognito API returns dates as epoch seconds (numbers)
 */
function keycloakToCognitoUser(user: KeycloakUser): Record<string, unknown> {
  // Cognito UserStatusType: ARCHIVED | COMPROMISED | CONFIRMED | EXTERNAL_PROVIDER | FORCE_CHANGE_PASSWORD | RESET_REQUIRED | UNCONFIRMED | UNKNOWN
  const userStatus = user.enabled ? "CONFIRMED" : "ARCHIVED";
  const now = Math.floor(Date.now() / 1000);

  return {
    Username: user.username,
    Attributes: keycloakToCognitoAttributes(user),
    UserCreateDate: user.createdTimestamp
      ? Math.floor(user.createdTimestamp / 1000)
      : now,
    UserLastModifiedDate: now,
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

// ============ User Action Handlers ============

async function adminCreateUser(
  request: AdminCreateUserRequest
): Promise<AdminCreateUserResponse> {
  const { Username, UserAttributes, TemporaryPassword, MessageAction } =
    request;

  if (!Username) {
    throw new Error("Username is required");
  }

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

  const { id } = await keycloakClient.createUser(keycloakPayload);

  // Fetch the created user to return full details
  const createdUser = await keycloakClient.getUserById(id);

  return {
    User: keycloakToCognitoUser(createdUser),
  };
}

async function adminDeleteUser(
  request: AdminDeleteUserRequest
): Promise<Record<string, never>> {
  const { Username } = request;

  if (!Username) {
    throw new Error("Username is required");
  }

  // Find user by username first
  const user = await keycloakClient.getUserByUsername(Username);

  if (!user) {
    throw new KeycloakError("User not found", 404);
  }

  await keycloakClient.deleteUser(user.id);

  return {};
}

async function adminGetUser(
  request: AdminGetUserRequest
): Promise<Record<string, unknown>> {
  const { Username } = request;

  if (!Username) {
    throw new Error("Username is required");
  }

  const user = await keycloakClient.getUserByUsername(Username);

  if (!user) {
    throw new KeycloakError("User not found", 404);
  }

  const now = Math.floor(Date.now() / 1000);

  // Return epoch seconds for dates - Cognito API uses epoch timestamps
  return {
    Username: user.username,
    UserAttributes: keycloakToCognitoAttributes(user),
    UserCreateDate: user.createdTimestamp
      ? Math.floor(user.createdTimestamp / 1000)
      : now,
    UserLastModifiedDate: now,
    Enabled: user.enabled,
    UserStatus: user.enabled ? "CONFIRMED" : "ARCHIVED",
  };
}

async function adminUpdateUserAttributes(
  request: AdminUpdateUserAttributesRequest
): Promise<AdminUpdateUserAttributesResponse> {
  const { Username, UserAttributes } = request;

  if (!Username) {
    throw new Error("Username is required");
  }

  const user = await keycloakClient.getUserByUsername(Username);

  if (!user) {
    throw new KeycloakError("User not found", 404);
  }

  // Build update payload
  const updatePayload: Partial<KeycloakUser> = {};

  if (UserAttributes) {
    const email = getAttributeValue(UserAttributes, "email");
    const firstName = getAttributeValue(UserAttributes, "given_name");
    const lastName = getAttributeValue(UserAttributes, "family_name");
    const emailVerified = getAttributeValue(UserAttributes, "email_verified");

    if (email !== undefined) updatePayload.email = email;
    if (firstName !== undefined) updatePayload.firstName = firstName;
    if (lastName !== undefined) updatePayload.lastName = lastName;
    if (emailVerified !== undefined) {
      updatePayload.emailVerified = emailVerified === "true";
    }

    // Update custom attributes
    updatePayload.attributes = {
      ...user.attributes,
      ...cognitoToKeycloakAttributes(UserAttributes),
    };
  }

  await keycloakClient.updateUser(user.id, updatePayload);

  return {};
}

async function adminSetUserPassword(
  request: AdminSetUserPasswordRequest
): Promise<AdminSetUserPasswordResponse> {
  const { Username, Password, Permanent } = request;

  if (!Username) {
    throw new Error("Username is required");
  }

  if (!Password) {
    throw new Error("Password is required");
  }

  const user = await keycloakClient.getUserByUsername(Username);

  if (!user) {
    throw new KeycloakError("User not found", 404);
  }

  await keycloakClient.setUserPassword(user.id, Password, !Permanent);

  return {};
}

async function adminEnableUser(
  request: AdminEnableUserRequest
): Promise<AdminEnableUserResponse> {
  const { Username } = request;

  if (!Username) {
    throw new Error("Username is required");
  }

  const user = await keycloakClient.getUserByUsername(Username);

  if (!user) {
    throw new KeycloakError("User not found", 404);
  }

  await keycloakClient.enableUser(user.id);

  return {};
}

async function adminDisableUser(
  request: AdminDisableUserRequest
): Promise<AdminDisableUserResponse> {
  const { Username } = request;

  if (!Username) {
    throw new Error("Username is required");
  }

  const user = await keycloakClient.getUserByUsername(Username);

  if (!user) {
    throw new KeycloakError("User not found", 404);
  }

  await keycloakClient.disableUser(user.id);

  return {};
}

async function listUsers(request: ListUsersRequest): Promise<ListUsersResponse> {
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

  const users = await keycloakClient.listUsers(searchParams);

  // Convert to Cognito format
  const cognitoUsers: UserType[] = users.map(keycloakToCognitoUser);

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

