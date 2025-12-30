// Configuration for the Cognito-Keycloak wrapper

export const config = {
  // Keycloak configuration
  keycloak: {
    baseUrl: process.env.KEYCLOAK_URL || "http://localhost:8080",
    realm: process.env.KEYCLOAK_REALM || "master",
    adminUsername: process.env.KEYCLOAK_ADMIN || "admin",
    adminPassword: process.env.KEYCLOAK_ADMIN_PASSWORD || "admin",
  },

  // Cognito wrapper configuration
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
  },

  // Hardcoded user pool for local development
  userPool: {
    id: process.env.USER_POOL_ID || "local_pool",
    name: "Local Development Pool",
  },
} as const;

export type Config = typeof config;

