import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	AdminAddUserToGroupCommand,
	AdminCreateUserCommand,
	AdminDeleteUserCommand,
	AdminListGroupsForUserCommand,
	AdminRemoveUserFromGroupCommand,
	type CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import type KcAdminClient from "@keycloak/keycloak-admin-client";
import {
	getKeycloakAdminClient,
	setupEnvironment,
	USER_POOL_ID,
} from "../setup.js";

describe("Cognito Group Management", () => {
	let client: CognitoIdentityProviderClient;
	let kcAdmin: KcAdminClient;
	const createdUsers: string[] = [];
	const createdGroups: string[] = [];

	beforeAll(async () => {
		const setup = await setupEnvironment();
		client = setup.cognitoClient;
		kcAdmin = await getKeycloakAdminClient();
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

		// Cleanup: delete all created groups
		for (const groupName of createdGroups) {
			try {
				const groups = await kcAdmin.groups.find({ search: groupName });
				const group = groups.find((g) => g.name === groupName);
				if (group?.id) {
					await kcAdmin.groups.del({ id: group.id });
				}
			} catch {
				// Ignore errors during cleanup
			}
		}
	});

	/**
	 * Helper to create a Keycloak group for testing
	 */
	async function createTestGroup(groupName: string): Promise<string> {
		const result = await kcAdmin.groups.create({ name: groupName });
		createdGroups.push(groupName);
		return result.id;
	}

	/**
	 * Helper to create a test user
	 */
	async function createTestUser(username: string): Promise<void> {
		await client.send(
			new AdminCreateUserCommand({
				UserPoolId: USER_POOL_ID,
				Username: username,
				UserAttributes: [{ Name: "email", Value: `${username}@example.com` }],
			}),
		);
		createdUsers.push(username);
	}

	describe("AdminListGroupsForUser", () => {
		it("should return empty list for user with no groups", async () => {
			const username = `grouptest-nogroups-${Date.now()}`;
			await createTestUser(username);

			const response = await client.send(
				new AdminListGroupsForUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);

			expect(response.Groups).toBeDefined();
			expect(response.Groups).toEqual([]);
		});

		it("should return groups for user", async () => {
			const username = `grouptest-withgroups-${Date.now()}`;
			const groupName = `testgroup-list-${Date.now()}`;

			await createTestGroup(groupName);
			await createTestUser(username);

			// Add user to group
			await client.send(
				new AdminAddUserToGroupCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					GroupName: groupName,
				}),
			);

			const response = await client.send(
				new AdminListGroupsForUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);

			expect(response.Groups).toBeDefined();
			expect(response.Groups?.length).toBeGreaterThanOrEqual(1);

			const foundGroup = response.Groups?.find(
				(g) => g.GroupName === groupName,
			);
			expect(foundGroup).toBeDefined();
			expect(foundGroup?.GroupName).toBe(groupName);
		});

		it("should throw for non-existent user", async () => {
			await expect(
				client.send(
					new AdminListGroupsForUserCommand({
						UserPoolId: USER_POOL_ID,
						Username: "nonexistent-user-groups-12345",
					}),
				),
			).rejects.toThrow();
		});
	});

	describe("AdminAddUserToGroup", () => {
		it("should add user to group", async () => {
			const username = `grouptest-add-${Date.now()}`;
			const groupName = `testgroup-add-${Date.now()}`;

			await createTestGroup(groupName);
			await createTestUser(username);

			// Add user to group - should succeed without throwing
			await client.send(
				new AdminAddUserToGroupCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					GroupName: groupName,
				}),
			);

			// Verify user is in group
			const response = await client.send(
				new AdminListGroupsForUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);

			const foundGroup = response.Groups?.find(
				(g) => g.GroupName === groupName,
			);
			expect(foundGroup).toBeDefined();
		});

		it("should throw for non-existent user", async () => {
			const groupName = `testgroup-add-nouser-${Date.now()}`;
			await createTestGroup(groupName);

			await expect(
				client.send(
					new AdminAddUserToGroupCommand({
						UserPoolId: USER_POOL_ID,
						Username: "nonexistent-user-12345",
						GroupName: groupName,
					}),
				),
			).rejects.toThrow();
		});

		it("should throw for non-existent group", async () => {
			const username = `grouptest-add-nogroup-${Date.now()}`;
			await createTestUser(username);

			await expect(
				client.send(
					new AdminAddUserToGroupCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
						GroupName: "nonexistent-group-12345",
					}),
				),
			).rejects.toThrow();
		});
	});

	describe("AdminRemoveUserFromGroup", () => {
		it("should remove user from group", async () => {
			const username = `grouptest-remove-${Date.now()}`;
			const groupName = `testgroup-remove-${Date.now()}`;

			await createTestGroup(groupName);
			await createTestUser(username);

			// Add user to group first
			await client.send(
				new AdminAddUserToGroupCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					GroupName: groupName,
				}),
			);

			// Verify user is in group
			let response = await client.send(
				new AdminListGroupsForUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);
			expect(
				response.Groups?.find((g) => g.GroupName === groupName),
			).toBeDefined();

			// Remove user from group - should succeed without throwing
			await client.send(
				new AdminRemoveUserFromGroupCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					GroupName: groupName,
				}),
			);

			// Verify user is no longer in group
			response = await client.send(
				new AdminListGroupsForUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);
			expect(
				response.Groups?.find((g) => g.GroupName === groupName),
			).toBeUndefined();
		});

		it("should throw for non-existent user", async () => {
			const groupName = `testgroup-remove-nouser-${Date.now()}`;
			await createTestGroup(groupName);

			await expect(
				client.send(
					new AdminRemoveUserFromGroupCommand({
						UserPoolId: USER_POOL_ID,
						Username: "nonexistent-user-12345",
						GroupName: groupName,
					}),
				),
			).rejects.toThrow();
		});

		it("should throw for non-existent group", async () => {
			const username = `grouptest-remove-nogroup-${Date.now()}`;
			await createTestUser(username);

			await expect(
				client.send(
					new AdminRemoveUserFromGroupCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
						GroupName: "nonexistent-group-12345",
					}),
				),
			).rejects.toThrow();
		});
	});

	describe("Multiple groups", () => {
		it("should handle user in multiple groups", async () => {
			const username = `grouptest-multi-${Date.now()}`;
			const groupName1 = `testgroup-multi-1-${Date.now()}`;
			const groupName2 = `testgroup-multi-2-${Date.now()}`;

			await createTestGroup(groupName1);
			await createTestGroup(groupName2);
			await createTestUser(username);

			// Add user to both groups
			await client.send(
				new AdminAddUserToGroupCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					GroupName: groupName1,
				}),
			);
			await client.send(
				new AdminAddUserToGroupCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					GroupName: groupName2,
				}),
			);

			// Verify user is in both groups
			const response = await client.send(
				new AdminListGroupsForUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);

			expect(response.Groups?.length).toBeGreaterThanOrEqual(2);
			expect(
				response.Groups?.find((g) => g.GroupName === groupName1),
			).toBeDefined();
			expect(
				response.Groups?.find((g) => g.GroupName === groupName2),
			).toBeDefined();

			// Remove from one group
			await client.send(
				new AdminRemoveUserFromGroupCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
					GroupName: groupName1,
				}),
			);

			// Verify user is only in second group
			const response2 = await client.send(
				new AdminListGroupsForUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: username,
				}),
			);

			expect(
				response2.Groups?.find((g) => g.GroupName === groupName1),
			).toBeUndefined();
			expect(
				response2.Groups?.find((g) => g.GroupName === groupName2),
			).toBeDefined();
		});
	});
});
