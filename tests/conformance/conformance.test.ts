import { beforeAll, describe, expect, it } from "bun:test";
import { isDeepStrictEqual } from "node:util";
import {
	AdminAddUserToGroupCommand,
	AdminCreateUserCommand,
	AdminDeleteUserCommand,
	AdminDisableUserCommand,
	AdminEnableUserCommand,
	AdminGetUserCommand,
	AdminListGroupsForUserCommand,
	AdminRemoveUserFromGroupCommand,
	AdminSetUserPasswordCommand,
	AdminUpdateUserAttributesCommand,
	CognitoIdentityProviderClient,
	CreateGroupCommand,
	DeleteGroupCommand,
	GetGroupCommand,
	ListGroupsCommand,
	ListUsersCommand,
	ListUsersInGroupCommand,
	UpdateGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { setupEnvironment, USER_POOL_ID } from "../setup.js";

const REAL_USER_POOL_ID = process.env.REAL_USER_POOL_ID!;
const REAL_COGNITO_REGION = process.env.REAL_COGNITO_REGION || "us-east-1";

type Normalized =
	| { ok: true; data: unknown }
	| {
			ok: false;
			error: {
				name?: string;
				httpStatusCode?: number;
			};
	  };

async function assertAwsCredentialsResolvable(
	client: CognitoIdentityProviderClient,
): Promise<void> {
	const creds = client.config.credentials;
	if (typeof creds !== "function") return;

	try {
		await creds();
	} catch (e) {
		const msg =
			e instanceof Error ? e.message : "Unknown credential resolution error";
		throw new Error(
			[
				"Unable to resolve AWS credentials using the default AWS SDK provider chain.",
				"Make sure your AWS CLI is configured (e.g. `aws configure` or `aws sso login`)",
				`Underlying error: ${msg}`,
			].join(" "),
		);
	}
}

function stripMetadata(value: unknown): unknown {
	if (!value || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(stripMetadata);

	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		if (k === "$metadata") continue;
		out[k] = stripMetadata(v);
	}
	return out;
}

async function capture(
	client: CognitoIdentityProviderClient,
	// biome-ignore lint/suspicious/noExplicitAny: It is hard to type this correctly, not worth the effort
	command: any,
): Promise<Normalized> {
	try {
		const result = await client.send(command);
		return { ok: true, data: stripMetadata(result) };
	} catch (err) {
		// AWS SDK v3 errors generally carry name/message and $metadata.httpStatusCode
		const e = err as {
			name?: string;
			message?: string;
			$metadata?: { httpStatusCode?: number };
		};
		return {
			ok: false,
			error: {
				name: e?.name,
				httpStatusCode: e?.$metadata?.httpStatusCode,
			},
		};
	}
}

type AttributeType = { Name?: string; Value?: string };

function normalizeAttributes(
	attrs: unknown,
): Record<string, string | undefined> | undefined {
	if (!Array.isArray(attrs)) return undefined;

	const out: Record<string, string | undefined> = {};
	for (const a of attrs as AttributeType[]) {
		const name = a?.Name;
		if (!name) continue;
		if (name === "sub") {
			out[name] = "<redacted>";
			continue;
		}
		out[name] = a?.Value;
	}

	// Stable key order for diffs/readability
	return Object.fromEntries(
		Object.entries(out).sort(([a], [b]) => a.localeCompare(b)),
	);
}

function normalizeUser(user: unknown): unknown {
	if (!user || typeof user !== "object") return user;
	const u = user as Record<string, unknown>;

	const attributes =
		normalizeAttributes(u.Attributes) ?? normalizeAttributes(u.UserAttributes);

	return {
		Username: u.Username,
		Enabled: u.Enabled,
		UserStatus: u.UserStatus,
		Attributes: attributes,
	};
}

function normalizeGroup(group: unknown): unknown {
	if (!group || typeof group !== "object") return group;
	const g = group as Record<string, unknown>;

	return {
		GroupName: g.GroupName,
		Description: g.Description,
		Precedence: g.Precedence,
		RoleArn: g.RoleArn,
	};
}

function normalizeOkData(data: unknown): unknown {
	if (!data || typeof data !== "object") return data;
	const obj = data as Record<string, unknown>;

	if ("User" in obj) {
		return { User: normalizeUser(obj.User) };
	}

	if ("Users" in obj && Array.isArray(obj.Users)) {
		const users = (obj.Users as unknown[]).map(normalizeUser) as Record<
			string,
			unknown
		>[];
		users.sort((a, b) =>
			String(a?.Username ?? "").localeCompare(String(b?.Username ?? "")),
		);
		return { Users: users };
	}

	if ("UserAttributes" in obj) {
		return {
			Username: obj.Username,
			UserAttributes: normalizeAttributes(obj.UserAttributes),
		};
	}

	// Group responses
	if ("Group" in obj) {
		return { Group: normalizeGroup(obj.Group) };
	}

	if ("Groups" in obj && Array.isArray(obj.Groups)) {
		const groups = (obj.Groups as unknown[]).map(normalizeGroup) as Record<
			string,
			unknown
		>[];
		groups.sort((a, b) =>
			String(a?.GroupName ?? "").localeCompare(String(b?.GroupName ?? "")),
		);
		return { Groups: groups };
	}

	// e.g. AdminDeleteUser/AdminDisableUser/AdminEnableUser/AdminSetUserPassword responses
	return obj;
}

function normalizeForCompare(result: Normalized): Normalized {
	if (!result.ok) {
		return {
			ok: false,
			error: {
				name: result.error.name,
				httpStatusCode: result.error.httpStatusCode,
			},
		};
	}
	return { ok: true, data: normalizeOkData(result.data) };
}

function compareOrCollect(
	step: string,
	local: Normalized,
	real: Normalized,
	diffs: Array<{ step: string; local: Normalized; real: Normalized }>,
): void {
	const l = normalizeForCompare(local);
	const r = normalizeForCompare(real);
	if (!isDeepStrictEqual(l, r)) {
		diffs.push({ step, local: l, real: r });
	}
}

async function safeDeleteUser(
	client: CognitoIdentityProviderClient,
	userPoolId: string,
	username: string,
): Promise<void> {
	try {
		await client.send(
			new AdminDeleteUserCommand({
				UserPoolId: userPoolId,
				Username: username,
			}),
		);
	} catch {
		// ignore cleanup errors
	}
}

async function safeDeleteGroup(
	client: CognitoIdentityProviderClient,
	userPoolId: string,
	groupName: string,
): Promise<void> {
	try {
		await client.send(
			new DeleteGroupCommand({
				UserPoolId: userPoolId,
				GroupName: groupName,
			}),
		);
	} catch {
		// ignore cleanup errors
	}
}

/**
 * Delete all test users matching common test patterns from a user pool.
 */
async function cleanupTestUsers(
	client: CognitoIdentityProviderClient,
	userPoolId: string,
): Promise<void> {
	const testUserPatterns = [/^testuser-/, /^conformance-/];

	try {
		// List all users (up to 60, should be enough for test cleanup)
		const result = await client.send(
			new ListUsersCommand({ UserPoolId: userPoolId, Limit: 60 }),
		);

		const users = result.Users ?? [];
		const testUsers = users.filter((u) =>
			testUserPatterns.some((pattern) => pattern.test(u.Username ?? "")),
		);

		// Delete all matching test users
		await Promise.all(
			testUsers.map((u) => safeDeleteUser(client, userPoolId, u.Username!)),
		);

		if (testUsers.length > 0) {
			console.log(
				`Cleaned up ${testUsers.length} test user(s) from pool ${userPoolId}`,
			);
		}
	} catch (err) {
		console.warn(
			`Warning: Failed to cleanup test users from ${userPoolId}:`,
			err,
		);
	}
}

/**
 * Delete all test groups matching common test patterns from a user pool.
 */
async function cleanupTestGroups(
	client: CognitoIdentityProviderClient,
	userPoolId: string,
): Promise<void> {
	const testGroupPatterns = [/^testgroup-/, /^conformance-/];

	try {
		// List all groups (up to 60, should be enough for test cleanup)
		const result = await client.send(
			new ListGroupsCommand({ UserPoolId: userPoolId, Limit: 60 }),
		);

		const groups = result.Groups ?? [];
		const testGroups = groups.filter((g) =>
			testGroupPatterns.some((pattern) => pattern.test(g.GroupName ?? "")),
		);

		// Delete all matching test groups
		await Promise.all(
			testGroups.map((g) => safeDeleteGroup(client, userPoolId, g.GroupName!)),
		);

		if (testGroups.length > 0) {
			console.log(
				`Cleaned up ${testGroups.length} test group(s) from pool ${userPoolId}`,
			);
		}
	} catch (err) {
		console.warn(
			`Warning: Failed to cleanup test groups from ${userPoolId}:`,
			err,
		);
	}
}

const conformanceDescribe = process.env.REAL_USER_POOL_ID
	? describe
	: describe.skip;

conformanceDescribe("Conformance tests (emulator vs real AWS Cognito)", () => {
	let localClient: CognitoIdentityProviderClient;
	let realClient: CognitoIdentityProviderClient | null = null;

	beforeAll(async () => {
		const setup = await setupEnvironment();
		localClient = setup.cognitoClient;

		// Rely on the AWS SDK default credential chain (same idea as AWS CLI),
		// so profiles/SSO/shared config work out of the box.
		realClient = new CognitoIdentityProviderClient({
			region: REAL_COGNITO_REGION,
		});

		await assertAwsCredentialsResolvable(realClient);

		// Clean up any leftover test users and groups from previous runs
		await Promise.all([
			cleanupTestUsers(localClient, USER_POOL_ID),
			cleanupTestUsers(realClient, REAL_USER_POOL_ID),
			cleanupTestGroups(localClient, USER_POOL_ID),
			cleanupTestGroups(realClient, REAL_USER_POOL_ID),
		]);
	});

	it("ListUsers: should list created user with matching structure", async () => {
		const username = `conformance-list-${Date.now()}`;
		const email = `${username}@hejare.se`;

		// Create a user on both sides first
		const createLocal = new AdminCreateUserCommand({
			UserPoolId: USER_POOL_ID,
			Username: username,
			MessageAction: "SUPPRESS",
			TemporaryPassword: "TempPass123!",
			UserAttributes: [
				{ Name: "email", Value: email },
				{ Name: "email_verified", Value: "true" },
				{ Name: "given_name", Value: "ListTest" },
				{ Name: "family_name", Value: "User" },
			],
		});
		const createReal = new AdminCreateUserCommand({
			UserPoolId: REAL_USER_POOL_ID,
			Username: username,
			MessageAction: "SUPPRESS",
			TemporaryPassword: "TempPass123!",
			UserAttributes: [
				{ Name: "email", Value: email },
				{ Name: "email_verified", Value: "true" },
				{ Name: "given_name", Value: "ListTest" },
				{ Name: "family_name", Value: "User" },
			],
		});

		const [createL, createR] = await Promise.all([
			capture(localClient, createLocal),
			capture(realClient!, createReal),
		]);

		// Ensure both users were created successfully
		expect(createL.ok).toBe(true);
		expect(createR.ok).toBe(true);

		try {
			// List users with a filter to find our specific test user
			const listLocal = new ListUsersCommand({
				UserPoolId: USER_POOL_ID,
				Filter: `username = "${username}"`,
			});
			const listReal = new ListUsersCommand({
				UserPoolId: REAL_USER_POOL_ID,
				Filter: `username = "${username}"`,
			});

			const [local, real] = await Promise.all([
				capture(localClient, listLocal),
				capture(realClient!, listReal),
			]);

			expect(normalizeForCompare(local)).toEqual(normalizeForCompare(real));
		} finally {
			// Cleanup: delete the test user on both sides
			await Promise.all([
				safeDeleteUser(localClient, USER_POOL_ID, username),
				safeDeleteUser(realClient!, REAL_USER_POOL_ID, username),
			]);
		}
	});

	it("AdminGetUser: non-existent username (should be a clean UserNotFoundException)", async () => {
		const missingUsername = `conformance-nonexistent-${Date.now()}`;

		const cmdLocal = new AdminGetUserCommand({
			UserPoolId: USER_POOL_ID,
			Username: missingUsername,
		});
		const cmdReal = new AdminGetUserCommand({
			UserPoolId: REAL_USER_POOL_ID,
			Username: missingUsername,
		});

		const [local, real] = await Promise.all([
			capture(localClient, cmdLocal),
			capture(realClient!, cmdReal),
		]);

		expect(normalizeForCompare(local)).toEqual(normalizeForCompare(real));
	});

	it("AdminCreateUser: invalid payload (missing Username) should match Cognito's validation behavior", async () => {
		const cmdLocal = new AdminCreateUserCommand({
			UserPoolId: USER_POOL_ID,
			// biome-ignore lint/suspicious/noExplicitAny: we want to test the invalid payload
		} as any);

		const cmdReal = new AdminCreateUserCommand({
			UserPoolId: REAL_USER_POOL_ID,
			// biome-ignore lint/suspicious/noExplicitAny: we want to test the invalid payload
		} as any);

		const [local, real] = await Promise.all([
			capture(localClient, cmdLocal),
			capture(realClient!, cmdReal),
		]);

		expect(normalizeForCompare(local)).toEqual(normalizeForCompare(real));
	});

	it("User lifecycle (mutating): create → update attrs → set password → disable/enable → delete", async () => {
		const diffs: Array<{
			step: string;
			local: Normalized;
			real: Normalized;
		}> = [];

		const username = `conformance-lifecycle-${Date.now()}`;
		const email = `${username}@hejare.se`;

		const createLocal = new AdminCreateUserCommand({
			UserPoolId: USER_POOL_ID,
			Username: username,
			MessageAction: "SUPPRESS",
			TemporaryPassword: "TempPass123!",
			UserAttributes: [
				{ Name: "email", Value: email },
				{ Name: "email_verified", Value: "true" },
				{ Name: "given_name", Value: "Diff" },
				{ Name: "family_name", Value: "Suite" },
			],
		});

		const createReal = new AdminCreateUserCommand({
			UserPoolId: REAL_USER_POOL_ID,
			Username: username,
			MessageAction: "SUPPRESS",
			TemporaryPassword: "TempPass123!",
			UserAttributes: [
				{ Name: "email", Value: email },
				{ Name: "email_verified", Value: "true" },
				{ Name: "given_name", Value: "Diff" },
				{ Name: "family_name", Value: "Suite" },
			],
		});

		const [createL, createR] = await Promise.all([
			capture(localClient, createLocal),
			capture(realClient!, createReal),
		]);
		compareOrCollect("AdminCreateUser", createL, createR, diffs);

		try {
			// Only proceed if both created successfully
			if (!createL.ok || !createR.ok) {
				if (diffs.length > 0) {
					throw new Error(
						`Conformance failure(s):\n${JSON.stringify(diffs, null, 2)}`,
					);
				}
				throw new Error("AdminCreateUser failed on at least one side.");
			}

			const [getL, getR] = await Promise.all([
				capture(
					localClient,
					new AdminGetUserCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
					}),
				),
				capture(
					realClient!,
					new AdminGetUserCommand({
						UserPoolId: REAL_USER_POOL_ID,
						Username: username,
					}),
				),
			]);
			compareOrCollect("AdminGetUser (after create)", getL, getR, diffs);

			const [updL, updR] = await Promise.all([
				capture(
					localClient,
					new AdminUpdateUserAttributesCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
						UserAttributes: [{ Name: "given_name", Value: "DiffUpdated" }],
					}),
				),
				capture(
					realClient!,
					new AdminUpdateUserAttributesCommand({
						UserPoolId: REAL_USER_POOL_ID,
						Username: username,
						UserAttributes: [{ Name: "given_name", Value: "DiffUpdated" }],
					}),
				),
			]);
			compareOrCollect("AdminUpdateUserAttributes", updL, updR, diffs);

			const [pwdL, pwdR] = await Promise.all([
				capture(
					localClient,
					new AdminSetUserPasswordCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
						Password: "PermPass123!",
						Permanent: true,
					}),
				),
				capture(
					realClient!,
					new AdminSetUserPasswordCommand({
						UserPoolId: REAL_USER_POOL_ID,
						Username: username,
						Password: "PermPass123!",
						Permanent: true,
					}),
				),
			]);
			compareOrCollect("AdminSetUserPassword", pwdL, pwdR, diffs);

			const [disL, disR] = await Promise.all([
				capture(
					localClient,
					new AdminDisableUserCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
					}),
				),
				capture(
					realClient!,
					new AdminDisableUserCommand({
						UserPoolId: REAL_USER_POOL_ID,
						Username: username,
					}),
				),
			]);
			compareOrCollect("AdminDisableUser", disL, disR, diffs);

			const [enL, enR] = await Promise.all([
				capture(
					localClient,
					new AdminEnableUserCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
					}),
				),
				capture(
					realClient!,
					new AdminEnableUserCommand({
						UserPoolId: REAL_USER_POOL_ID,
						Username: username,
					}),
				),
			]);
			compareOrCollect("AdminEnableUser", enL, enR, diffs);

			const [delL, delR] = await Promise.all([
				capture(
					localClient,
					new AdminDeleteUserCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
					}),
				),
				capture(
					realClient!,
					new AdminDeleteUserCommand({
						UserPoolId: REAL_USER_POOL_ID,
						Username: username,
					}),
				),
			]);
			compareOrCollect("AdminDeleteUser", delL, delR, diffs);

			const [getAfterDelL, getAfterDelR] = await Promise.all([
				capture(
					localClient,
					new AdminGetUserCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
					}),
				),
				capture(
					realClient!,
					new AdminGetUserCommand({
						UserPoolId: REAL_USER_POOL_ID,
						Username: username,
					}),
				),
			]);
			compareOrCollect(
				"AdminGetUser (after delete)",
				getAfterDelL,
				getAfterDelR,
				diffs,
			);
		} finally {
			// Best-effort cleanup on both sides (even if tests fail mid-way)
			await Promise.all([
				safeDeleteUser(localClient, USER_POOL_ID, username),
				safeDeleteUser(realClient!, REAL_USER_POOL_ID, username),
			]);
		}

		if (diffs.length > 0) {
			throw new Error(
				`Conformance failure(s):\n${JSON.stringify(diffs, null, 2)}`,
			);
		}
	});

	it("Group lifecycle: create → get → update → add user → list users → remove user → list groups for user → delete", async () => {
		const diffs: Array<{
			step: string;
			local: Normalized;
			real: Normalized;
		}> = [];

		const groupName = `conformance-group-${Date.now()}`;
		const username = `conformance-groupuser-${Date.now()}`;
		const email = `${username}@hejare.se`;

		// First, create a test user on both sides
		const createUserLocal = new AdminCreateUserCommand({
			UserPoolId: USER_POOL_ID,
			Username: username,
			MessageAction: "SUPPRESS",
			TemporaryPassword: "TempPass123!",
			UserAttributes: [
				{ Name: "email", Value: email },
				{ Name: "email_verified", Value: "true" },
			],
		});
		const createUserReal = new AdminCreateUserCommand({
			UserPoolId: REAL_USER_POOL_ID,
			Username: username,
			MessageAction: "SUPPRESS",
			TemporaryPassword: "TempPass123!",
			UserAttributes: [
				{ Name: "email", Value: email },
				{ Name: "email_verified", Value: "true" },
			],
		});

		const [createUserL, createUserR] = await Promise.all([
			capture(localClient, createUserLocal),
			capture(realClient!, createUserReal),
		]);

		if (!createUserL.ok || !createUserR.ok) {
			throw new Error("Failed to create test user for group lifecycle test");
		}

		try {
			// Create group
			const [createL, createR] = await Promise.all([
				capture(
					localClient,
					new CreateGroupCommand({
						UserPoolId: USER_POOL_ID,
						GroupName: groupName,
						Description: "Conformance test group",
						Precedence: 10,
					}),
				),
				capture(
					realClient!,
					new CreateGroupCommand({
						UserPoolId: REAL_USER_POOL_ID,
						GroupName: groupName,
						Description: "Conformance test group",
						Precedence: 10,
					}),
				),
			]);
			compareOrCollect("CreateGroup", createL, createR, diffs);

			if (!createL.ok || !createR.ok) {
				if (diffs.length > 0) {
					throw new Error(
						`Conformance failure(s):\n${JSON.stringify(diffs, null, 2)}`,
					);
				}
				throw new Error("CreateGroup failed on at least one side.");
			}

			// Get group
			const [getL, getR] = await Promise.all([
				capture(
					localClient,
					new GetGroupCommand({
						UserPoolId: USER_POOL_ID,
						GroupName: groupName,
					}),
				),
				capture(
					realClient!,
					new GetGroupCommand({
						UserPoolId: REAL_USER_POOL_ID,
						GroupName: groupName,
					}),
				),
			]);
			compareOrCollect("GetGroup (after create)", getL, getR, diffs);

			// Update group
			const [updL, updR] = await Promise.all([
				capture(
					localClient,
					new UpdateGroupCommand({
						UserPoolId: USER_POOL_ID,
						GroupName: groupName,
						Description: "Updated description",
						Precedence: 20,
					}),
				),
				capture(
					realClient!,
					new UpdateGroupCommand({
						UserPoolId: REAL_USER_POOL_ID,
						GroupName: groupName,
						Description: "Updated description",
						Precedence: 20,
					}),
				),
			]);
			compareOrCollect("UpdateGroup", updL, updR, diffs);

			// Get group after update
			const [getUpdL, getUpdR] = await Promise.all([
				capture(
					localClient,
					new GetGroupCommand({
						UserPoolId: USER_POOL_ID,
						GroupName: groupName,
					}),
				),
				capture(
					realClient!,
					new GetGroupCommand({
						UserPoolId: REAL_USER_POOL_ID,
						GroupName: groupName,
					}),
				),
			]);
			compareOrCollect("GetGroup (after update)", getUpdL, getUpdR, diffs);

			// Add user to group
			const [addL, addR] = await Promise.all([
				capture(
					localClient,
					new AdminAddUserToGroupCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
						GroupName: groupName,
					}),
				),
				capture(
					realClient!,
					new AdminAddUserToGroupCommand({
						UserPoolId: REAL_USER_POOL_ID,
						Username: username,
						GroupName: groupName,
					}),
				),
			]);
			compareOrCollect("AdminAddUserToGroup", addL, addR, diffs);

			// List users in group
			const [listUsersL, listUsersR] = await Promise.all([
				capture(
					localClient,
					new ListUsersInGroupCommand({
						UserPoolId: USER_POOL_ID,
						GroupName: groupName,
					}),
				),
				capture(
					realClient!,
					new ListUsersInGroupCommand({
						UserPoolId: REAL_USER_POOL_ID,
						GroupName: groupName,
					}),
				),
			]);
			compareOrCollect("ListUsersInGroup", listUsersL, listUsersR, diffs);

			// List groups for user
			const [listGroupsL, listGroupsR] = await Promise.all([
				capture(
					localClient,
					new AdminListGroupsForUserCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
					}),
				),
				capture(
					realClient!,
					new AdminListGroupsForUserCommand({
						UserPoolId: REAL_USER_POOL_ID,
						Username: username,
					}),
				),
			]);
			compareOrCollect(
				"AdminListGroupsForUser",
				listGroupsL,
				listGroupsR,
				diffs,
			);

			// Remove user from group
			const [removeL, removeR] = await Promise.all([
				capture(
					localClient,
					new AdminRemoveUserFromGroupCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
						GroupName: groupName,
					}),
				),
				capture(
					realClient!,
					new AdminRemoveUserFromGroupCommand({
						UserPoolId: REAL_USER_POOL_ID,
						Username: username,
						GroupName: groupName,
					}),
				),
			]);
			compareOrCollect("AdminRemoveUserFromGroup", removeL, removeR, diffs);

			// List groups for user (should be empty now)
			const [listGroupsAfterL, listGroupsAfterR] = await Promise.all([
				capture(
					localClient,
					new AdminListGroupsForUserCommand({
						UserPoolId: USER_POOL_ID,
						Username: username,
					}),
				),
				capture(
					realClient!,
					new AdminListGroupsForUserCommand({
						UserPoolId: REAL_USER_POOL_ID,
						Username: username,
					}),
				),
			]);
			compareOrCollect(
				"AdminListGroupsForUser (after remove)",
				listGroupsAfterL,
				listGroupsAfterR,
				diffs,
			);

			// Delete group
			const [delL, delR] = await Promise.all([
				capture(
					localClient,
					new DeleteGroupCommand({
						UserPoolId: USER_POOL_ID,
						GroupName: groupName,
					}),
				),
				capture(
					realClient!,
					new DeleteGroupCommand({
						UserPoolId: REAL_USER_POOL_ID,
						GroupName: groupName,
					}),
				),
			]);
			compareOrCollect("DeleteGroup", delL, delR, diffs);

			// Get group after delete (should fail)
			const [getAfterDelL, getAfterDelR] = await Promise.all([
				capture(
					localClient,
					new GetGroupCommand({
						UserPoolId: USER_POOL_ID,
						GroupName: groupName,
					}),
				),
				capture(
					realClient!,
					new GetGroupCommand({
						UserPoolId: REAL_USER_POOL_ID,
						GroupName: groupName,
					}),
				),
			]);
			compareOrCollect(
				"GetGroup (after delete)",
				getAfterDelL,
				getAfterDelR,
				diffs,
			);
		} finally {
			// Best-effort cleanup on both sides
			await Promise.all([
				safeDeleteGroup(localClient, USER_POOL_ID, groupName),
				safeDeleteGroup(realClient!, REAL_USER_POOL_ID, groupName),
				safeDeleteUser(localClient, USER_POOL_ID, username),
				safeDeleteUser(realClient!, REAL_USER_POOL_ID, username),
			]);
		}

		if (diffs.length > 0) {
			throw new Error(
				`Conformance failure(s):\n${JSON.stringify(diffs, null, 2)}`,
			);
		}
	});
});
