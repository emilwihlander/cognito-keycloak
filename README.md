# Cognito-Keycloak

AWS Cognito wrapper for Keycloak - a local development tool that provides
Cognito-compatible APIs backed by Keycloak.

## Overview

This project exists to support local development of web applications that use
AWS Cognito as an Identity Provider (IDP).

By using Keycloak behind the scenes, this emulator provides a full-featured
identity provider that handles OAuth 2.0/OIDC flows, user authentication, and
session management just like the real Cognito service. It translates Cognito API
calls to Keycloak's Admin REST API, while OAuth 2.0/OIDC endpoints are proxied
directly to Keycloak.

**Key feature:** Distributed as a single Docker image containing both Keycloak
and the Cognito API wrapper — no docker-compose or multiple containers needed.

## Quick Start

```bash
# Run the all-in-one container
docker run -p 4566:4566 -p 8080:8080 cognito-keycloak

# Or build and run locally
docker build -t cognito-keycloak .
docker run -p 4566:4566 -p 8080:8080 cognito-keycloak
```

This starts:

- **Cognito API** on `http://localhost:4566`
- **Keycloak** on `http://localhost:8080` (admin/admin)

### Configuration

Override defaults with environment variables:

```bash
docker run -p 4566:4566 -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=myadmin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=mysecret \
  -e USER_POOL_ID=my_pool \
  cognito-keycloak
```

| Variable                      | Default      | Description              |
| ----------------------------- | ------------ | ------------------------ |
| `PORT`                        | `4566`       | Port for the Cognito API |
| `KC_BOOTSTRAP_ADMIN_USERNAME` | `admin`      | Keycloak admin username  |
| `KC_BOOTSTRAP_ADMIN_PASSWORD` | `admin`      | Keycloak admin password  |
| `USER_POOL_ID`                | `local_pool` | Hardcoded user pool ID   |

## Local Development

For development on this project itself:

```bash
# Install dependencies
bun install

# Start Keycloak (required for the wrapper to function)
docker run -d --name keycloak -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  -v $(pwd)/keycloak:/opt/keycloak/data/import \
  quay.io/keycloak/keycloak:26.0 start-dev --import-realm

# Start the wrapper in development mode
bun run dev
```

## Endpoints

### Cognito IDP API

All Cognito actions are sent as `POST` requests to `/` with the `X-Amz-Target`
header:

```bash
curl -X POST http://localhost:4566/ \
  -H "Content-Type: application/x-amz-json-1.1" \
  -H "X-Amz-Target: AWSCognitoIdentityProviderService.ListUsers" \
  -d '{"UserPoolId": "local_pool"}'
```

### OAuth 2.0 / OIDC Endpoints

| Endpoint                                | Description              |
| --------------------------------------- | ------------------------ |
| `GET /.well-known/openid-configuration` | OpenID Connect Discovery |
| `GET /.well-known/jwks.json`            | JSON Web Key Set         |
| `GET /oauth2/authorize`                 | Authorization endpoint   |
| `POST /oauth2/token`                    | Token endpoint           |
| `GET/POST /oauth2/userInfo`             | UserInfo endpoint        |
| `POST /oauth2/revoke`                   | Token revocation         |
| `GET/POST /logout`                      | Logout endpoint          |

## Supported Actions

### User Management

- `AdminCreateUser` - Create a new user
- `AdminDeleteUser` - Delete a user
- `AdminGetUser` - Get user details
- `AdminUpdateUserAttributes` - Update user attributes
- `AdminDeleteUserAttributes` - Delete specific user attributes
- `AdminSetUserPassword` - Set user password
- `AdminResetUserPassword` - Reset user password and trigger reset flow
- `AdminEnableUser` - Enable a user
- `AdminDisableUser` - Disable a user
- `AdminConfirmSignUp` - Confirm user registration
- `AdminUserGlobalSignOut` - Sign out user from all devices
- `ListUsers` - List all users

### Group Management

- `CreateGroup` - Create a new group
- `GetGroup` - Get group details
- `UpdateGroup` - Update group attributes
- `DeleteGroup` - Delete a group
- `ListGroups` - List all groups
- `ListUsersInGroup` - List users in a group
- `AdminListGroupsForUser` - List groups for a user
- `AdminAddUserToGroup` - Add a user to a group
- `AdminRemoveUserFromGroup` - Remove a user from a group

### User Pool

- `DescribeUserPool` - Get user pool configuration

## Usage with AWS SDK

Configure the AWS SDK to use this local endpoint:

```typescript
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({
  endpoint: "http://localhost:4566",
  region: "us-east-1",
  credentials: {
    accessKeyId: "local",
    secretAccessKey: "local",
  },
});
```

## Usage with AWS CLI

```bash
aws cognito-idp list-users \
  --region us-east-1 \
  --endpoint-url http://localhost:4566 \
  --user-pool-id local_pool
```

## Keycloak UI

Access the Keycloak admin console at `http://localhost:8080` with:

- Username: `admin`
- Password: `admin`

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                     Single Docker Container                        │
│  ┌──────────────────┐         ┌──────────────────┐                │
│  │   Cognito API    │         │    Keycloak      │                │
│  │   (Port 4566)    │────────▶│   (Port 8080)    │                │
│  │                  │         │                  │                │
│  │ • Cognito IDP    │         │ • Admin REST API │                │
│  │ • OAuth Proxy    │         │ • OIDC Endpoints │                │
│  └──────────────────┘         └──────────────────┘                │
└────────────────────────────────────────────────────────────────────┘
                              Your App
```

The container uses Bun's single-file executable feature to bundle the wrapper
into a standalone binary with no external dependencies, which is then embedded
alongside Keycloak in a single image.

## Testing

Tests use the official AWS SDK against the Cognito API. Keycloak must be
running:

```bash
# Option 1: Run the all-in-one container (with Keycloak on port 8080)
docker run -d --name cognito-test -p 8080:8080 cognito-keycloak

# Option 2: Run just Keycloak for development
docker run -d --name keycloak -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  -v $(pwd)/keycloak:/opt/keycloak/data/import \
  quay.io/keycloak/keycloak:26.0 start-dev --import-realm

# Run all tests (with Keycloak on default port 8080)
bun test

# If Keycloak is running on a different port, set KEYCLOAK_URL:
KEYCLOAK_URL=http://localhost:8180 bun test

# Watch mode
bun test --watch
```

The test suite includes:

- Integration tests (health, users, user pool)
- Conformance tests (compares emulator vs real AWS Cognito)

For diff tests against real AWS, configure credentials via AWS CLI
(`aws sso login`) and set `REAL_USER_POOL_ID` in `.env`:

```
REAL_USER_POOL_ID=us-east-1_xxxxxxxx
```

## Building the Docker Image

```bash
# Build the image
docker build -t cognito-keycloak .

# Run the container
docker run -p 4566:4566 -p 8080:8080 cognito-keycloak
```

## License

Apache License 2.0

This project is licensed under the Apache License, Version 2.0. See the
[LICENSE](LICENSE) file for details.

This project includes Keycloak, which is also distributed under the Apache
License, Version 2.0. See the [NOTICE](NOTICE) file for attribution information.
