import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	AdminAddUserToGroupCommand,
	AdminCreateUserCommand,
	AdminDeleteUserCommand,
	AdminListGroupsForUserCommand,
	AdminRemoveUserFromGroupCommand,
	type CognitoIdentityProviderClient,
	CreateGroupCommand,
	DeleteGroupCommand,
	GetGroupCommand,
	ListGroupsCommand,
	ListUsersInGroupCommand,
	UpdateGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type KcAdminClient from "@keycloak/keycloak-admin-client";
import {
	getKeycloakAdminClient,
	setupEnvironment,
	stopServer,
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
		await stopServer();
	});

	/**
	 * Helper to create a group via Cognito API for testing
	 */
	async function createTestGroup(
		groupName: string,
		options?: { description?: string; precedence?: number; roleArn?: string },
	): Promise<void> {
		await client.send(
			new CreateGroupCommand({
				UserPoolId: USER_POOL_ID,
				GroupName: groupName,
				Description: options?.description,
				Precedence: options?.precedence,
				RoleArn: options?.roleArn,
			}),
		);
		createdGroups.push(groupName);
	}

	/**
	 * Helper to create a Keycloak group directly for testing edge cases
	 */
	async function createKeycloakGroup(groupName: string): Promise<string> {
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

	describe("CreateGroup", () => {
		it("should create a basic group", async () => {
			const groupName = `testgroup-create-${Date.now()}`;

			const response = await client.send(
				new CreateGroupCommand({
					UserPoolId: USER_POOL_ID,
					GroupName: groupName,
				}),
			);
			createdGroups.push(groupName);

			expect(response.Group).toBeDefined();
			expect(response.Group?.GroupName).toBe(groupName);
		});

		it("should create a group with all attributes", async () => {
			const groupName = `testgroup-create-full-${Date.now()}`;

			const response = await client.send(
				new CreateGroupCommand({
					UserPoolId: USER_POOL_ID,
					GroupName: groupName,
					Description: "Test description",
					Precedence: 10,
					RoleArn: "arn:aws:iam::123456789:role/TestRole",
				}),
			);
			createdGroups.push(groupName);

			expect(response.Group).toBeDefined();
			expect(response.Group?.GroupName).toBe(groupName);
			expect(response.Group?.Description).toBe("Test description");
			expect(response.Group?.Precedence).toBe(10);
			expect(response.Group?.RoleArn).toBe(
				"arn:aws:iam::123456789:role/TestRole",
			);
		});

		it("should throw for duplicate group name", async () => {
			const groupName = `testgroup-create-dup-${Date.now()}`;
			await createTestGroup(groupName);

			await expect(
				client.send(
					new CreateGroupCommand({
						UserPoolId: USER_POOL_ID,
						GroupName: groupName,
					}),
				),
			).rejects.toThrow();
		});
	});

	describe("GetGroup", () => {
		it("should get an existing group", async () => {
			const groupName = `testgroup-get-${Date.now()}`;
			await createTestGroup(groupName, {
				description: "Test group",
				precedence: 5,
			});

			const response = await client.send(
				new GetGroupCommand({
					UserPoolId: USER_POOL_ID,
					GroupName: groupName,
				}),
			);

			expect(response.Group).toBeDefined();
			expect(response.Group?.GroupName).toBe(groupName);
			expect(response.Group?.Description).toBe("Test group");
			expect(response.Group?.Precedence).toBe(5);
		});

		it("should throw for non-existent group", async () => {
			await expect(
				client.send(
					new GetGroupCommand({
						UserPoolId: USER_POOL_ID,
						GroupName: "nonexistent-group-12345",
					}),
				),
			).rejects.toThrow();
		});
	});

	describe("DeleteGroup", () => {
		it("should delete an existing group", async () => {
			const groupName = `testgroup-delete-${Date.now()}`;
			await createKeycloakGroup(groupName);

			// Delete the group
			await client.send(
				new DeleteGroupCommand({
					UserPoolId: USER_POOL_ID,
					GroupName: groupName,
				}),
			);

			// Verify it's gone
			await expect(
				client.send(
					new GetGroupCommand({
						UserPoolId: USER_POOL_ID,
						GroupName: groupName,
					}),
				),
			).rejects.toThrow();

			// Remove from cleanup list since it's already deleted
			const idx = createdGroups.indexOf(groupName);
			if (idx > -1) createdGroups.splice(idx, 1);
		});

		it("should throw for non-existent group", async () => {
			await expect(
				client.send(
					new DeleteGroupCommand({
						UserPoolId: USER_POOL_ID,
						GroupName: "nonexistent-group-delete-12345",
					}),
				),
			).rejects.toThrow();
		});
	});

	describe("ListGroups", () => {
		it("should list groups", async () => {
			const groupName = `testgroup-list-all-${Date.now()}`;
			await createTestGroup(groupName);

			const response = await client.send(
				new ListGroupsCommand({
					UserPoolId: USER_POOL_ID,
				}),
			);

			expect(response.Groups).toBeDefined();
			expect(response.Groups?.length).toBeGreaterThanOrEqual(1);

			const foundGroup = response.Groups?.find(
				(g) => g.GroupName === groupName,
			);
			expect(foundGroup).toBeDefined();
		});

		it("should support pagination", async () => {
			// Create multiple groups
			const prefix = `testgroup-paginate-${Date.now()}`;
			for (let i = 0; i < 3; i++) {
				await createTestGroup(`${prefix}-${i}`);
			}

			// Request with limit
			const response = await client.send(
				new ListGroupsCommand({
					UserPoolId: USER_POOL_ID,
					Limit: 2,
				}),
			);

			expect(response.Groups).toBeDefined();
			expect(response.Groups?.length).toBeLessThanOrEqual(2);

			// Verify NextToken is returned when more groups exist
			// (we created 3 groups, limit is 2, so there should be more)
			expect(response.NextToken).toBeDefined();

			// Verify we can use NextToken to get more groups
			const response2 = await client.send(
				new ListGroupsCommand({
					UserPoolId: USER_POOL_ID,
					Limit: 2,
					NextToken: response.NextToken,
				}),
			);

			expect(response2.Groups).toBeDefined();
		});
	});

	describe("ListUsersInGroup", () => {
		it("should return empty list for group with no users", async () => {
			const groupName = `testgroup-listusers-empty-${Date.now()}`;
			await createTestGroup(groupName);

			const response = await client.send(
				new ListUsersInGroupCommand({
					UserPoolId: USER_POOL_ID,
					GroupName: groupName,
				}),
			);

			expect(response.Users).toBeDefined();
			expect(response.Users).toEqual([]);
		});

		it("should return users in group", async () => {
			const groupName = `testgroup-listusers-${Date.now()}`;
			const username = `grouptest-listusers-${Date.now()}`;

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
				new ListUsersInGroupCommand({
					UserPoolId: USER_POOL_ID,
					GroupName: groupName,
				}),
			);

			expect(response.Users).toBeDefined();
			expect(response.Users?.length).toBe(1);
			expect(response.Users?.[0].Username).toBe(username);
		});

		it("should throw for non-existent group", async () => {
			await expect(
				client.send(
					new ListUsersInGroupCommand({
						UserPoolId: USER_POOL_ID,
						GroupName: "nonexistent-group-listusers-12345",
					}),
				),
			).rejects.toThrow();
		});
	});

	describe("UpdateGroup", () => {
		it("should update group description", async () => {
			const groupName = `testgroup-update-${Date.now()}`;
			await createTestGroup(groupName, { description: "Original" });

			const response = await client.send(
				new UpdateGroupCommand({
					UserPoolId: USER_POOL_ID,
					GroupName: groupName,
					Description: "Updated description",
				}),
			);

			expect(response.Group?.Description).toBe("Updated description");

			// Verify with GetGroup
			const getResponse = await client.send(
				new GetGroupCommand({
					UserPoolId: USER_POOL_ID,
					GroupName: groupName,
				}),
			);
			expect(getResponse.Group?.Description).toBe("Updated description");
		});

		it("should update group precedence", async () => {
			const groupName = `testgroup-update-prec-${Date.now()}`;
			await createTestGroup(groupName, { precedence: 5 });

			const response = await client.send(
				new UpdateGroupCommand({
					UserPoolId: USER_POOL_ID,
					GroupName: groupName,
					Precedence: 20,
				}),
			);

			expect(response.Group?.Precedence).toBe(20);
		});

		it("should update role ARN", async () => {
			const groupName = `testgroup-update-role-${Date.now()}`;
			await createTestGroup(groupName);

			const response = await client.send(
				new UpdateGroupCommand({
					UserPoolId: USER_POOL_ID,
					GroupName: groupName,
					RoleArn: "arn:aws:iam::123456789:role/NewRole",
				}),
			);

			expect(response.Group?.RoleArn).toBe(
				"arn:aws:iam::123456789:role/NewRole",
			);
		});

		it("should throw for non-existent group", async () => {
			await expect(
				client.send(
					new UpdateGroupCommand({
						UserPoolId: USER_POOL_ID,
						GroupName: "nonexistent-group-update-12345",
						Description: "Test",
					}),
				),
			).rejects.toThrow();
		});
	});

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
