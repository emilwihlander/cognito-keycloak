# Cognito-Keycloak

AWS Cognito wrapper for Keycloak - a local development tool that provides Cognito-compatible APIs backed by Keycloak.

## Overview

This project allows you to develop and test applications that use AWS Cognito without needing an actual AWS account. It translates Cognito API calls to Keycloak's Admin REST API, while OAuth 2.0/OIDC endpoints are proxied directly to Keycloak.

## Quick Start

### Using Docker

```bash
# Build the image
docker build -t cognito-keycloak .

# Run the container
docker run -p 3000:3000 -p 8080:8080 cognito-keycloak
```

### Local Development

```bash
# Install dependencies
npm install

# Start Keycloak separately with realm import
docker run -p 8080:8080 \
  -e KEYCLOAK_ADMIN=admin \
  -e KEYCLOAK_ADMIN_PASSWORD=admin \
  -v $(pwd)/keycloak:/opt/keycloak/data/import \
  quay.io/keycloak/keycloak:26.0 start-dev --import-realm

# Start the wrapper
npm run dev
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port for the Cognito API |
| `KEYCLOAK_URL` | `http://localhost:8080` | Keycloak base URL |
| `KEYCLOAK_REALM` | `cognito` | Keycloak realm to use |
| `KEYCLOAK_ADMIN` | `admin` | Keycloak admin username |
| `KEYCLOAK_ADMIN_PASSWORD` | `admin` | Keycloak admin password |
| `USER_POOL_ID` | `local_pool` | Hardcoded user pool ID |

## Endpoints

### Cognito IDP API

All Cognito actions are sent as `POST` requests to `/` with the `X-Amz-Target` header:

```bash
curl -X POST http://localhost:3000/ \
  -H "Content-Type: application/x-amz-json-1.1" \
  -H "X-Amz-Target: AWSCognitoIdentityProviderService.ListUsers" \
  -d '{"UserPoolId": "local_pool"}'
```

### OAuth 2.0 / OIDC Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /.well-known/openid-configuration` | OpenID Connect Discovery |
| `GET /.well-known/jwks.json` | JSON Web Key Set |
| `GET /oauth2/authorize` | Authorization endpoint |
| `POST /oauth2/token` | Token endpoint |
| `GET/POST /oauth2/userInfo` | UserInfo endpoint |
| `POST /oauth2/revoke` | Token revocation |
| `GET/POST /logout` | Logout endpoint |

## Supported Actions

### User Management

- `AdminCreateUser` - Create a new user
- `AdminDeleteUser` - Delete a user
- `AdminGetUser` - Get user details
- `AdminUpdateUserAttributes` - Update user attributes
- `AdminSetUserPassword` - Set user password
- `AdminEnableUser` - Enable a user
- `AdminDisableUser` - Disable a user
- `ListUsers` - List all users

## Usage with AWS SDK

Configure the AWS SDK to use this local endpoint:

```typescript
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({
  endpoint: "http://localhost:3000",
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
  --endpoint-url http://localhost:3000 \
  --user-pool-id local_pool
```

## Keycloak UI

Access the Keycloak admin console at `http://localhost:8080` with:
- Username: `admin`
- Password: `admin`

## Architecture

```
┌─────────────────────────────────────────────────┐
│                Docker Container                  │
│                                                  │
│  ┌──────────────────┐    ┌──────────────────┐   │
│  │   Hono App       │    │    Keycloak      │   │
│  │   (Port 3000)    │───▶│   (Port 8080)    │   │
│  │                  │    │                  │   │
│  │ • Cognito API    │    │ • Admin REST API │   │
│  │ • OAuth Proxy    │    │ • OIDC Endpoints │   │
│  └──────────────────┘    └──────────────────┘   │
│                                                  │
└─────────────────────────────────────────────────┘
```

## License

MIT

