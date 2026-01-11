#!/bin/bash
set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║        Cognito-Keycloak Local Development Server           ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Start Keycloak in the background with health enabled
echo "→ Starting Keycloak..."
/opt/keycloak/bin/kc.sh start-dev --health-enabled=true &
KEYCLOAK_PID=$!

# Wait for Keycloak to be ready using TCP port check and then a simple HTTP check
echo "→ Waiting for Keycloak to be ready..."
MAX_RETRIES=120
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    # Use bash's built-in TCP check since curl isn't available in Keycloak image
    if (exec 3<>/dev/tcp/localhost/8080) 2>/dev/null; then
        exec 3>&-
        # Port is open, now check if realm endpoint responds
        # Use a simple HEAD request via bash
        if exec 3<>/dev/tcp/localhost/8080 2>/dev/null; then
            echo -e "GET /realms/master/.well-known/openid-configuration HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n" >&3
            RESPONSE=$(cat <&3 | head -1)
            exec 3>&-
            if [[ "$RESPONSE" == *"200"* ]]; then
                echo "✓ Keycloak is ready!"
                break
            fi
        fi
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $((RETRY_COUNT % 10)) -eq 0 ]; then
        echo "  Still waiting for Keycloak... ($RETRY_COUNT/$MAX_RETRIES)"
    fi
    sleep 1
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "✗ Keycloak failed to start within timeout"
    exit 1
fi

# Give Keycloak a moment to fully initialize after responding
sleep 2

# Start the Cognito wrapper
# The wrapper will create the default realm on startup
echo ""
echo "→ Starting Cognito API wrapper..."
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  Cognito API:  http://localhost:${PORT:-4566}                        ║"
echo "║  User Pool ID: ${USER_POOL_ID:-local_pool}                                 ║"
echo "║  Keycloak:     http://localhost:8080                       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Run the cognito wrapper in the foreground
# If it exits, we want the container to exit too
exec /opt/cognito/cognito-wrapper
