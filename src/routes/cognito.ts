import { Hono } from "hono";
import { dispatchAction, getSupportedActions } from "../handlers/index.js";
import { config } from "../config.js";

const cognito = new Hono();

/**
 * Main Cognito IDP API endpoint
 * All actions are sent as POST to / with X-Amz-Target header
 */
cognito.post("/", async (c) => {
  return dispatchAction(c);
});

/**
 * Health check / info endpoint
 */
cognito.get("/", async (c) => {
  return c.json({
    service: "cognito-keycloak",
    description: "AWS Cognito wrapper for Keycloak (local development)",
    userPoolId: config.userPool.id,
    supportedActions: getSupportedActions(),
  });
});

/**
 * DescribeUserPool - returns mock user pool info
 * This can be called via the action header or directly
 */
cognito.get("/user-pools/:poolId", async (c) => {
  const poolId = c.req.param("poolId");

  if (poolId !== config.userPool.id) {
    return c.json(
      {
        __type: "ResourceNotFoundException",
        message: `User pool ${poolId} does not exist.`,
      },
      404
    );
  }

  return c.json({
    UserPool: {
      Id: config.userPool.id,
      Name: config.userPool.name,
      Status: "Active",
      CreationDate: new Date().toISOString(),
      LastModifiedDate: new Date().toISOString(),
    },
  });
});

export { cognito };

