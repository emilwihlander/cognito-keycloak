import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	AdminCreateUserCommand,
	AdminDeleteUserCommand,
	type CognitoIdentityProviderClient,
	DescribeUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { setupEnvironment, stopServer, USER_POOL_ID } from "../setup.js";

describe("Cognito User Pool", () => {
	let client: CognitoIdentityProviderClient;

	beforeAll(async () => {
		const setup = await setupEnvironment();
		client = setup.cognitoClient;
	});

	afterAll(async () => {
		await stopServer();
	});

	describe("DescribeUserPool", () => {
		it("should return user pool configuration", async () => {
			const response = await client.send(
				new DescribeUserPoolCommand({
					UserPoolId: USER_POOL_ID,
				}),
			);

			expect(response.UserPool).toBeDefined();
			expect(response.UserPool?.Id).toBe(USER_POOL_ID);
			expect(response.UserPool?.Name).toBeDefined();
		});

		it("should include password policy", async () => {
			const response = await client.send(
				new DescribeUserPoolCommand({
					UserPoolId: USER_POOL_ID,
				}),
			);

			const passwordPolicy = response.UserPool?.Policies?.PasswordPolicy;
			expect(passwordPolicy).toBeDefined();
			expect(passwordPolicy?.MinimumLength).toBe(8);
			expect(passwordPolicy?.RequireUppercase).toBe(true);
			expect(passwordPolicy?.RequireLowercase).toBe(true);
			expect(passwordPolicy?.RequireNumbers).toBe(true);
			expect(passwordPolicy?.RequireSymbols).toBe(true);
			expect(passwordPolicy?.TemporaryPasswordValidityDays).toBe(7);
		});

		it("should include schema attributes", async () => {
			const response = await client.send(
				new DescribeUserPoolCommand({
					UserPoolId: USER_POOL_ID,
				}),
			);

			const schemaAttributes = response.UserPool?.SchemaAttributes;
			expect(schemaAttributes).toBeDefined();
			expect(Array.isArray(schemaAttributes)).toBe(true);

			// Check for essential attributes
			const attributeNames = schemaAttributes?.map((attr) => attr.Name) ?? [];
			expect(attributeNames).toContain("sub");
			expect(attributeNames).toContain("email");
			expect(attributeNames).toContain("email_verified");
			expect(attributeNames).toContain("given_name");
			expect(attributeNames).toContain("family_name");

			// Verify sub attribute is required and immutable
			const subAttr = schemaAttributes?.find((attr) => attr.Name === "sub");
			expect(subAttr?.Required).toBe(true);
			expect(subAttr?.Mutable).toBe(false);

			// Verify email attribute is required
			const emailAttr = schemaAttributes?.find((attr) => attr.Name === "email");
			expect(emailAttr?.Required).toBe(true);
			expect(emailAttr?.Mutable).toBe(true);
		});

		it("should include admin create user config", async () => {
			const response = await client.send(
				new DescribeUserPoolCommand({
					UserPoolId: USER_POOL_ID,
				}),
			);

			const adminConfig = response.UserPool?.AdminCreateUserConfig;
			expect(adminConfig).toBeDefined();
			expect(adminConfig?.AllowAdminCreateUserOnly).toBe(true);
			expect(adminConfig?.UnusedAccountValidityDays).toBe(7);
		});

		it("should include username configuration", async () => {
			const response = await client.send(
				new DescribeUserPoolCommand({
					UserPoolId: USER_POOL_ID,
				}),
			);

			const usernameConfig = response.UserPool?.UsernameConfiguration;
			expect(usernameConfig).toBeDefined();
			expect(usernameConfig?.CaseSensitive).toBe(false);
		});

		it("should include account recovery settings", async () => {
			const response = await client.send(
				new DescribeUserPoolCommand({
					UserPoolId: USER_POOL_ID,
				}),
			);

			const recoverySettings = response.UserPool?.AccountRecoverySetting;
			expect(recoverySettings).toBeDefined();
			expect(recoverySettings?.RecoveryMechanisms).toBeDefined();
			expect(Array.isArray(recoverySettings?.RecoveryMechanisms)).toBe(true);

			// Check that verified_email is a recovery mechanism
			const emailRecovery = recoverySettings?.RecoveryMechanisms?.find(
				(m) => m.Name === "verified_email",
			);
			expect(emailRecovery).toBeDefined();
			expect(emailRecovery?.Priority).toBe(1);
		});

		it("should include MFA configuration", async () => {
			const response = await client.send(
				new DescribeUserPoolCommand({
					UserPoolId: USER_POOL_ID,
				}),
			);

			expect(response.UserPool?.MfaConfiguration).toBe("OFF");
		});

		it("should include auto-verified attributes", async () => {
			const response = await client.send(
				new DescribeUserPoolCommand({
					UserPoolId: USER_POOL_ID,
				}),
			);

			expect(response.UserPool?.AutoVerifiedAttributes).toBeDefined();
			expect(response.UserPool?.AutoVerifiedAttributes).toContain("email");
		});

		it("should reflect accurate estimated number of users", async () => {
			// Get initial count
			const initialResponse = await client.send(
				new DescribeUserPoolCommand({
					UserPoolId: USER_POOL_ID,
				}),
			);
			const initialCount =
				initialResponse.UserPool?.EstimatedNumberOfUsers ?? 0;

			// Create a user
			const username = `testuser-pool-count-${Date.now()}`;
			await client.send(
				new AdminCreateUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					UserAttributes: [{ Name: "email", Value: `${username}@example.com` }],
				}),
			);

			try {
				// Get updated count
				const updatedResponse = await client.send(
					new DescribeUserPoolCommand({
						UserPoolId: USER_POOL_ID,
					}),
				);
				const updatedCount =
					updatedResponse.UserPool?.EstimatedNumberOfUsers ?? 0;

				expect(updatedCount).toBe(initialCount + 1);
			} finally {
				// Cleanup
				await client.send(
					new AdminDeleteUserCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
					}),
				);
			}
		});

		it("should include ARN", async () => {
			const response = await client.send(
				new DescribeUserPoolCommand({
					UserPoolId: USER_POOL_ID,
				}),
			);

			expect(response.UserPool?.Arn).toBeDefined();
			expect(response.UserPool?.Arn).toContain(USER_POOL_ID);
		});

		it("should include deletion protection status", async () => {
			const response = await client.send(
				new DescribeUserPoolCommand({
					UserPoolId: USER_POOL_ID,
				}),
			);

			expect(response.UserPool?.DeletionProtection).toBe("ACTIVE");
		});
	});
});
