import { config } from "../config.js";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface KeycloakUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified?: boolean;
  createdTimestamp?: number;
  attributes?: Record<string, string[]>;
}

interface CreateUserPayload {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  emailVerified?: boolean;
  attributes?: Record<string, string[]>;
  credentials?: Array<{
    type: string;
    value: string;
    temporary?: boolean;
  }>;
}

interface SetPasswordPayload {
  type: "password";
  value: string;
  temporary: boolean;
}

class KeycloakAdminClient {
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  private get baseUrl(): string {
    return config.keycloak.baseUrl;
  }

  private get realm(): string {
    return config.keycloak.realm;
  }

  private get adminUrl(): string {
    return `${this.baseUrl}/admin/realms/${this.realm}`;
  }

  /**
   * Get a valid admin access token, refreshing if necessary
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();

    // Return cached token if still valid (with 30s buffer)
    if (this.accessToken && this.tokenExpiresAt > now + 30000) {
      return this.accessToken;
    }

    // Get new token using admin credentials
    const tokenUrl = `${this.baseUrl}/realms/master/protocol/openid-connect/token`;

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: config.keycloak.adminUsername,
        password: config.keycloak.adminPassword,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get admin token: ${response.status} ${error}`);
    }

    const data: TokenResponse = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiresAt = now + data.expires_in * 1000;

    return this.accessToken;
  }

  /**
   * Make an authenticated request to the Keycloak Admin API
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${this.adminUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Handle 201 Created (returns Location header, no body)
    if (response.status === 201) {
      const location = response.headers.get("Location");
      if (location) {
        // Extract user ID from location header
        const id = location.split("/").pop();
        return { id } as T;
      }
      return {} as T;
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    if (!response.ok) {
      const error = await response.text();
      throw new KeycloakError(
        `Keycloak API error: ${response.status} ${error}`,
        response.status
      );
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }

  // ============ User Operations ============

  /**
   * Create a new user
   */
  async createUser(payload: CreateUserPayload): Promise<{ id: string }> {
    return this.request<{ id: string }>("POST", "/users", payload);
  }

  /**
   * Get a user by ID
   */
  async getUserById(userId: string): Promise<KeycloakUser> {
    return this.request<KeycloakUser>("GET", `/users/${userId}`);
  }

  /**
   * Get a user by username
   */
  async getUserByUsername(username: string): Promise<KeycloakUser | null> {
    const users = await this.request<KeycloakUser[]>(
      "GET",
      `/users?username=${encodeURIComponent(username)}&exact=true`
    );
    return users.length > 0 ? users[0] : null;
  }

  /**
   * List users with optional filters
   */
  async listUsers(params?: {
    first?: number;
    max?: number;
    search?: string;
    email?: string;
    username?: string;
  }): Promise<KeycloakUser[]> {
    const searchParams = new URLSearchParams();

    if (params?.first !== undefined) {
      searchParams.set("first", params.first.toString());
    }
    if (params?.max !== undefined) {
      searchParams.set("max", params.max.toString());
    }
    if (params?.search) {
      searchParams.set("search", params.search);
    }
    if (params?.email) {
      searchParams.set("email", params.email);
    }
    if (params?.username) {
      searchParams.set("username", params.username);
    }

    const query = searchParams.toString();
    const path = query ? `/users?${query}` : "/users";

    return this.request<KeycloakUser[]>("GET", path);
  }

  /**
   * Update a user
   */
  async updateUser(
    userId: string,
    payload: Partial<KeycloakUser>
  ): Promise<void> {
    await this.request("PUT", `/users/${userId}`, payload);
  }

  /**
   * Delete a user
   */
  async deleteUser(userId: string): Promise<void> {
    await this.request("DELETE", `/users/${userId}`);
  }

  /**
   * Set user password
   */
  async setUserPassword(
    userId: string,
    password: string,
    temporary: boolean = false
  ): Promise<void> {
    const payload: SetPasswordPayload = {
      type: "password",
      value: password,
      temporary,
    };
    await this.request("PUT", `/users/${userId}/reset-password`, payload);
  }

  /**
   * Enable a user
   */
  async enableUser(userId: string): Promise<void> {
    await this.updateUser(userId, { enabled: true });
  }

  /**
   * Disable a user
   */
  async disableUser(userId: string): Promise<void> {
    await this.updateUser(userId, { enabled: false });
  }

  /**
   * Count total users
   */
  async countUsers(): Promise<number> {
    return this.request<number>("GET", "/users/count");
  }
}

export class KeycloakError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "KeycloakError";
  }
}

// Singleton instance
export const keycloakClient = new KeycloakAdminClient();

// Export types for use in handlers
export type { KeycloakUser, CreateUserPayload };

