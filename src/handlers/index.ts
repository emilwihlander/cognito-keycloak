import type { Context } from "hono";
import { userHandlers } from "./users.js";

// Action handler type - accepts any JSON body and returns any response
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// Create a Cognito-style error response
function createErrorResponse(
  code: string,
  message: string
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
        "Missing or invalid X-Amz-Target header"
      ),
      400
    );
  }

  const handler = actionHandlers[action];

  if (!handler) {
    return c.json(
      createErrorResponse(
        "InvalidAction",
        `Action ${action} is not supported`
      ),
      400
    );
  }

  try {
    const body = await c.req.json();
    const result = await handler(body);
    return c.json(result);
  } catch (error) {
    console.error(`Error handling action ${action}:`, error);

    if (error instanceof Error) {
      // Check for specific error types
      if (error.message.includes("404")) {
        return c.json(
          createErrorResponse("UserNotFoundException", "User does not exist."),
          400
        );
      }
      if (error.message.includes("409")) {
        return c.json(
          createErrorResponse(
            "UsernameExistsException",
            "An account with the given username already exists."
          ),
          400
        );
      }

      return c.json(
        createErrorResponse("InternalErrorException", error.message),
        500
      );
    }

    return c.json(
      createErrorResponse("InternalErrorException", "An unknown error occurred"),
      500
    );
  }
}

// Export list of supported actions for documentation/debugging
export function getSupportedActions(): string[] {
  return Object.keys(actionHandlers);
}

