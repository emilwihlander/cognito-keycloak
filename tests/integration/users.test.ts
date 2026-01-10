import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	AdminConfirmSignUpCommand,
	AdminCreateUserCommand,
	AdminDeleteUserAttributesCommand,
	AdminDeleteUserCommand,
	AdminDisableUserCommand,
	AdminEnableUserCommand,
	AdminGetUserCommand,
	AdminResetUserPasswordCommand,
	AdminSetUserPasswordCommand,
	AdminUpdateUserAttributesCommand,
	AdminUserGlobalSignOutCommand,
	type CognitoIdentityProviderClient,
	ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { setupEnvironment, USER_POOL_ID } from "../setup.js";

describe("Cognito User Management", () => {
	let client: CognitoIdentityProviderClient;
	const createdUsers: string[] = [];

	beforeAll(async () => {
		const setup = await setupEnvironment();
		client = setup.cognitoClient;
	});

	afterAll(async () => {
		// Cleanup: delete all created users
		for (const username of createdUsers) {
			try {
				await client.send(
					new AdminDeleteUserCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
					}),
				);
			} catch {
				// Ignore errors during cleanup
			}
		}
	});

	describe("AdminCreateUser", () => {
		it("should create a user with basic attributes", async () => {
			const username = `testuser-${Date.now()}`;
			createdUsers.push(username);

			const response = await client.send(
				new AdminCreateUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					UserAttributes: [
						{ Name: "email", Value: `${username}@example.com` },
						{ Name: "given_name", Value: "Test" },
						{ Name: "family_name", Value: "User" },
						{ Name: "email_verified", Value: "true" },
					],
				}),
			);

			expect(response.User).toBeDefined();
			expect(response.User?.Username).toBe(username);
			expect(response.User?.Enabled).toBe(true);

			// Verify email attribute
			const emailAttr = response.User?.Attributes?.find(
				(a) => a.Name === "email",
			);
			expect(emailAttr?.Value).toBe(`${username}@example.com`);

			// Verify email_verified flag is set to true
			const emailVerifiedAttr = response.User?.Attributes?.find(
				(a) => a.Name === "email_verified",
			);
			expect(emailVerifiedAttr?.Value).toBe("true");
		});

		it("should create a user with a temporary password", async () => {
			const username = `testuser-pwd-${Date.now()}`;
			createdUsers.push(username);

			const response = await client.send(
				new AdminCreateUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					TemporaryPassword: "TempPass123!",
					UserAttributes: [{ Name: "email", Value: `${username}@example.com` }],
				}),
			);

			expect(response.User).toBeDefined();
			expect(response.User?.Username).toBe(username);
		});

		it("should fail when creating a duplicate user", async () => {
			const username = `testuser-dup-${Date.now()}`;
			createdUsers.push(username);

			// Create first user
			await client.send(
				new AdminCreateUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					UserAttributes: [{ Name: "email", Value: `${username}@example.com` }],
				}),
			);

			// Try to create duplicate
			await expect(
				client.send(
					new AdminCreateUserCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
						UserAttributes: [
							{ Name: "email", Value: `${username}@example.com` },
						],
					}),
				),
			).rejects.toThrow();
		});
	});

	describe("AdminGetUser", () => {
		it("should retrieve an existing user", async () => {
			const username = `testuser-get-${Date.now()}`;
			createdUsers.push(username);

			// Create user first
			await client.send(
				new AdminCreateUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					UserAttributes: [
						{ Name: "email", Value: `${username}@example.com` },
						{ Name: "given_name", Value: "Get" },
						{ Name: "family_name", Value: "Test" },
					],
				}),
			);

			// Get user
			const response = await client.send(
				new AdminGetUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);

			expect(response.Username).toBe(username);
			expect(response.Enabled).toBe(true);

			const emailAttr = response.UserAttributes?.find(
				(a) => a.Name === "email",
			);
			expect(emailAttr?.Value).toBe(`${username}@example.com`);

			const givenNameAttr = response.UserAttributes?.find(
				(a) => a.Name === "given_name",
			);
			expect(givenNameAttr?.Value).toBe("Get");
		});

		it("should throw when user does not exist", async () => {
			await expect(
				client.send(
					new AdminGetUserCommand({
						UserPoolId: USER_POOL_ID,
						Username: "nonexistent-user-12345",
					}),
				),
			).rejects.toThrow();
		});
	});

	describe("AdminUpdateUserAttributes", () => {
		it("should update user attributes", async () => {
			const username = `testuser-update-${Date.now()}`;
			createdUsers.push(username);

			// Create user
			await client.send(
				new AdminCreateUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					UserAttributes: [
						{ Name: "email", Value: `${username}@example.com` },
						{ Name: "given_name", Value: "Original" },
					],
				}),
			);

			// Update attributes
			await client.send(
				new AdminUpdateUserAttributesCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					UserAttributes: [
						{ Name: "given_name", Value: "Updated" },
						{ Name: "family_name", Value: "NewLastName" },
					],
				}),
			);

			// Verify update
			const response = await client.send(
				new AdminGetUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);

			const givenNameAttr = response.UserAttributes?.find(
				(a) => a.Name === "given_name",
			);
			expect(givenNameAttr?.Value).toBe("Updated");

			const familyNameAttr = response.UserAttributes?.find(
				(a) => a.Name === "family_name",
			);
			expect(familyNameAttr?.Value).toBe("NewLastName");
		});
	});

	describe("AdminSetUserPassword", () => {
		it("should set a permanent password", async () => {
			const username = `testuser-setpwd-${Date.now()}`;
			createdUsers.push(username);

			// Create user
			await client.send(
				new AdminCreateUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					UserAttributes: [{ Name: "email", Value: `${username}@example.com` }],
				}),
			);

			// Set password - should not throw
			await expect(
				client.send(
					new AdminSetUserPasswordCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
						Password: "NewPermanentPass123!",
						Permanent: true,
					}),
				),
			).resolves.toBeDefined();
		});
	});

	describe("AdminEnableUser / AdminDisableUser", () => {
		it("should disable and enable a user", async () => {
			const username = `testuser-toggle-${Date.now()}`;
			createdUsers.push(username);

			// Create user
			await client.send(
				new AdminCreateUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					UserAttributes: [{ Name: "email", Value: `${username}@example.com` }],
				}),
			);

			// Disable user
			await client.send(
				new AdminDisableUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);

			// Verify disabled
			let response = await client.send(
				new AdminGetUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);
			expect(response.Enabled).toBe(false);

			// Enable user
			await client.send(
				new AdminEnableUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);

			// Verify enabled
			response = await client.send(
				new AdminGetUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);
			expect(response.Enabled).toBe(true);
		});
	});

	describe("AdminDeleteUser", () => {
		it("should delete an existing user", async () => {
			const username = `testuser-delete-${Date.now()}`;

			// Create user
			await client.send(
				new AdminCreateUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					UserAttributes: [{ Name: "email", Value: `${username}@example.com` }],
				}),
			);

			// Delete user
			await client.send(
				new AdminDeleteUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);

			// Verify deleted - should throw
			await expect(
				client.send(
					new AdminGetUserCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
					}),
				),
			).rejects.toThrow();
		});
	});

	describe("ListUsers", () => {
		it("should list all users", async () => {
			// Create a few users
			const usernames = [
				`listuser-1-${Date.now()}`,
				`listuser-2-${Date.now()}`,
				`listuser-3-${Date.now()}`,
			];

			for (const username of usernames) {
				createdUsers.push(username);
				await client.send(
					new AdminCreateUserCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
						UserAttributes: [
							{ Name: "email", Value: `${username}@example.com` },
						],
					}),
				);
			}

			// List users
			const response = await client.send(
				new ListUsersCommand({
					UserPoolId: USER_POOL_ID,
				}),
			);

			expect(response.Users).toBeDefined();
			expect(response.Users?.length).toBeGreaterThanOrEqual(3);

			// Verify our users are in the list
			for (const username of usernames) {
				const found = response.Users?.find((u) => u.Username === username);
				expect(found).toBeDefined();
			}
		});

		it("should support pagination with Limit", async () => {
			const response = await client.send(
				new ListUsersCommand({
					UserPoolId: USER_POOL_ID,
					Limit: 2,
				}),
			);

			expect(response.Users).toBeDefined();
			expect(response.Users?.length).toBeLessThanOrEqual(2);
		});
	});

	describe("AdminDeleteUserAttributes", () => {
		it("should delete standard user attributes", async () => {
			const username = `testuser-delattr-${Date.now()}`;
			createdUsers.push(username);

			// Create user with attributes
			await client.send(
				new AdminCreateUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					UserAttributes: [
						{ Name: "email", Value: `${username}@example.com` },
						{ Name: "given_name", Value: "Test" },
						{ Name: "family_name", Value: "User" },
					],
				}),
			);

			// Delete given_name and family_name attributes
			await client.send(
				new AdminDeleteUserAttributesCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					UserAttributeNames: ["given_name", "family_name"],
				}),
			);

			// Verify attributes are deleted
			const response = await client.send(
				new AdminGetUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);

			const givenNameAttr = response.UserAttributes?.find(
				(a) => a.Name === "given_name",
			);
			const familyNameAttr = response.UserAttributes?.find(
				(a) => a.Name === "family_name",
			);

			expect(givenNameAttr).toBeUndefined();
			expect(familyNameAttr).toBeUndefined();
		});

		it("should delete custom attributes", async () => {
			const username = `testuser-delcustom-${Date.now()}`;
			createdUsers.push(username);

			// Create user with custom attribute
			await client.send(
				new AdminCreateUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					UserAttributes: [
						{ Name: "email", Value: `${username}@example.com` },
						{ Name: "custom:department", Value: "Engineering" },
					],
				}),
			);

			// Delete custom attribute
			await client.send(
				new AdminDeleteUserAttributesCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					UserAttributeNames: ["custom:department"],
				}),
			);

			// Verify attribute is deleted
			const response = await client.send(
				new AdminGetUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);

			const deptAttr = response.UserAttributes?.find(
				(a) => a.Name === "custom:department",
			);
			expect(deptAttr).toBeUndefined();
		});

		it("should throw when user does not exist", async () => {
			await expect(
				client.send(
					new AdminDeleteUserAttributesCommand({
						UserPoolId: USER_POOL_ID,
						Username: "nonexistent-user-12345",
						UserAttributeNames: ["given_name"],
					}),
				),
			).rejects.toThrow();
		});
	});

	describe("AdminConfirmSignUp", () => {
		it("should confirm a user signup", async () => {
			const username = `testuser-confirm-${Date.now()}`;
			createdUsers.push(username);

			// Create user with email_verified false
			await client.send(
				new AdminCreateUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					UserAttributes: [
						{ Name: "email", Value: `${username}@example.com` },
						{ Name: "email_verified", Value: "false" },
					],
				}),
			);

			// Confirm signup
			await client.send(
				new AdminConfirmSignUpCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);

			// Verify email is now verified
			const response = await client.send(
				new AdminGetUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);

			const emailVerifiedAttr = response.UserAttributes?.find(
				(a) => a.Name === "email_verified",
			);
			expect(emailVerifiedAttr?.Value).toBe("true");
		});

		it("should throw when user does not exist", async () => {
			await expect(
				client.send(
					new AdminConfirmSignUpCommand({
						UserPoolId: USER_POOL_ID,
						Username: "nonexistent-user-12345",
					}),
				),
			).rejects.toThrow();
		});
	});

	describe("AdminResetUserPassword", () => {
		it("should reset a user password and set RESET_REQUIRED status", async () => {
			const username = `testuser-reset-${Date.now()}`;
			createdUsers.push(username);

			// Create user with email (required for password reset email) and permanent password
			await client.send(
				new AdminCreateUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					MessageAction: "SUPPRESS",
					UserAttributes: [
						{ Name: "email", Value: `${username}@example.com` },
						{ Name: "email_verified", Value: "true" },
					],
				}),
			);

			await client.send(
				new AdminSetUserPasswordCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					Password: "PermanentPass123!",
					Permanent: true,
				}),
			);

			// Verify user is CONFIRMED
			let response = await client.send(
				new AdminGetUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);
			expect(response.UserStatus).toBe("CONFIRMED");

			// Reset password - should not throw
			await expect(
				client.send(
					new AdminResetUserPasswordCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
					}),
				),
			).resolves.toBeDefined();

			// Verify user status changed to FORCE_CHANGE_PASSWORD (Keycloak uses UPDATE_PASSWORD action)
			response = await client.send(
				new AdminGetUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);
			expect(response.UserStatus).toBe("FORCE_CHANGE_PASSWORD");
		});

		it("should throw when user does not exist", async () => {
			await expect(
				client.send(
					new AdminResetUserPasswordCommand({
						UserPoolId: USER_POOL_ID,
						Username: "nonexistent-user-12345",
					}),
				),
			).rejects.toThrow();
		});
	});

	describe("AdminUserGlobalSignOut", () => {
		it("should sign out a user from all sessions", async () => {
			const username = `testuser-signout-${Date.now()}`;
			createdUsers.push(username);

			// Create user
			await client.send(
				new AdminCreateUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					UserAttributes: [{ Name: "email", Value: `${username}@example.com` }],
				}),
			);

			// Global sign out - should not throw
			await expect(
				client.send(
					new AdminUserGlobalSignOutCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
					}),
				),
			).resolves.toBeDefined();
		});

		it("should throw when user does not exist", async () => {
			await expect(
				client.send(
					new AdminUserGlobalSignOutCommand({
						UserPoolId: USER_POOL_ID,
						Username: "nonexistent-user-12345",
					}),
				),
			).rejects.toThrow();
		});
	});
});
