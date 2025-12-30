#!/bin/bash
# Setup script for Keycloak initial configuration
# This script creates a client in the master realm for OAuth flows

set -e

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
KEYCLOAK_ADMIN="${KEYCLOAK_ADMIN:-admin}"
KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
REALM="master"
CLIENT_ID="${CLIENT_ID:-cognito-local}"
REDIRECT_URIS="${REDIRECT_URIS:-http://localhost:3000/*,http://localhost:4000/*,http://localhost:5000/*}"

echo "Waiting for Keycloak to be ready..."
until curl -sf "${KEYCLOAK_URL}/health/ready" > /dev/null 2>&1; do
  sleep 2
done
echo "Keycloak is ready!"

# Get admin token
echo "Getting admin token..."
TOKEN_RESPONSE=$(curl -s -X POST "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" \
  -d "username=${KEYCLOAK_ADMIN}" \
  -d "password=${KEYCLOAK_ADMIN_PASSWORD}")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Failed to get admin token"
  exit 1
fi

echo "Got admin token"

# Check if client already exists
CLIENT_EXISTS=$(curl -s -X GET "${KEYCLOAK_URL}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" | grep -c "${CLIENT_ID}" || true)

if [ "$CLIENT_EXISTS" -gt 0 ]; then
  echo "Client ${CLIENT_ID} already exists, skipping creation"
  exit 0
fi

# Create OAuth client
echo "Creating OAuth client: ${CLIENT_ID}"
IFS=',' read -ra URIS <<< "$REDIRECT_URIS"
URIS_JSON=$(printf '"%s",' "${URIS[@]}" | sed 's/,$//')

curl -s -X POST "${KEYCLOAK_URL}/admin/realms/${REALM}/clients" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientId\": \"${CLIENT_ID}\",
    \"name\": \"Cognito Local Development Client\",
    \"enabled\": true,
    \"publicClient\": false,
    \"secret\": \"cognito-local-secret\",
    \"redirectUris\": [${URIS_JSON}],
    \"webOrigins\": [\"*\"],
    \"standardFlowEnabled\": true,
    \"directAccessGrantsEnabled\": true,
    \"serviceAccountsEnabled\": true,
    \"authorizationServicesEnabled\": false,
    \"protocol\": \"openid-connect\",
    \"attributes\": {
      \"oauth2.device.authorization.grant.enabled\": \"true\",
      \"oidc.ciba.grant.enabled\": \"false\"
    }
  }"

echo ""
echo "✓ Client ${CLIENT_ID} created successfully"
echo ""
echo "OAuth Client Configuration:"
echo "  Client ID:     ${CLIENT_ID}"
echo "  Client Secret: cognito-local-secret"
echo "  Redirect URIs: ${REDIRECT_URIS}"

