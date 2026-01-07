import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { setupContainer, teardownContainer } from "./setup.js";

describe("Health Check", () => {
	let cognitoEndpoint: string;
	let keycloakEndpoint: string;

	beforeAll(async () => {
		const setup = await setupContainer();
		cognitoEndpoint = setup.cognitoEndpoint;
		keycloakEndpoint = setup.keycloakEndpoint;
	});

	afterAll(async () => {
		await teardownContainer();
	});

	it("should return healthy status from Cognito wrapper", async () => {
		const response = await fetch(`${cognitoEndpoint}/health`);
		expect(response.ok).toBe(true);

		const data = await response.json();
		expect(data.status).toBe("ok");
	});

	it("should return service info from root endpoint", async () => {
		const response = await fetch(cognitoEndpoint);
		expect(response.ok).toBe(true);

		const data = await response.json();
		expect(data.service).toBe("cognito-keycloak");
		expect(data.userPoolId).toBe("local_pool");
		expect(data.supportedActions).toContain("AdminCreateUser");
		expect(data.supportedActions).toContain("ListUsers");
	});

	it("should have Keycloak running and healthy", async () => {
		// In dev mode, Keycloak doesn't expose /health, so check OIDC config instead
		const response = await fetch(
			`${keycloakEndpoint}/realms/cognito/.well-known/openid-configuration`,
		);
		expect(response.ok).toBe(true);
		const config = await response.json();
		expect(config.issuer).toContain("cognito");
	});

	it("should expose OpenID configuration", async () => {
		const response = await fetch(
			`${cognitoEndpoint}/.well-known/openid-configuration`,
		);
		expect(response.ok).toBe(true);

		const config = await response.json();
		expect(config.issuer).toBeDefined();
		expect(config.authorization_endpoint).toBeDefined();
		expect(config.token_endpoint).toBeDefined();
		expect(config.jwks_uri).toBeDefined();
	});
});
