import { Hono } from "hono";
import { config } from "../config.js";
import { dispatchAction, getSupportedActions } from "../handlers/index.js";

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

export { cognito };
