# =============================================================================
# Stage 1: Build the Cognito wrapper as a single-file executable using Bun
# Use Debian-based image for glibc compatibility with Keycloak's UBI image
# =============================================================================
FROM oven/bun:1-debian AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./
COPY tsconfig.json ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY src/ ./src/

# Detect the architecture and build accordingly
# This ensures the binary matches the target runtime architecture
ARG TARGETARCH
RUN echo "Building for architecture: ${TARGETARCH:-$(uname -m)}" && \
    if [ "${TARGETARCH}" = "arm64" ] || [ "$(uname -m)" = "aarch64" ]; then \
        bun build ./src/index.ts --compile --target=bun-linux-arm64 --outfile cognito-wrapper; \
    else \
        bun build ./src/index.ts --compile --target=bun-linux-x64 --outfile cognito-wrapper; \
    fi

# =============================================================================
# Stage 2: Final image based on Keycloak with embedded Cognito wrapper
# =============================================================================
FROM quay.io/keycloak/keycloak:26.0

# Switch to root to install our wrapper
USER root

# Copy the single-file executable (no dependencies needed!)
COPY --from=builder /app/cognito-wrapper /opt/cognito/cognito-wrapper
RUN chmod +x /opt/cognito/cognito-wrapper

# Copy realm configuration
COPY keycloak/realm-config.json /opt/keycloak/data/import/realm-config.json

# Copy startup script
COPY entrypoint.sh /opt/cognito/entrypoint.sh
RUN chmod +x /opt/cognito/entrypoint.sh

# Environment variables
ENV KEYCLOAK_ADMIN=admin
ENV KEYCLOAK_ADMIN_PASSWORD=admin
ENV KEYCLOAK_URL=http://localhost:8080
ENV KEYCLOAK_REALM=cognito
ENV PORT=4566
ENV USER_POOL_ID=local_pool

# Expose ports: 4566 for Cognito API, 8080 for Keycloak (optional direct access)
EXPOSE 4566 8080

# Health check against the Cognito wrapper (Keycloak image doesn't have curl, but we check via TCP in entrypoint)
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=10 \
    CMD exec 3<>/dev/tcp/localhost/4566 && echo -e "GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n" >&3 && cat <&3 | grep -q '"status":"ok"'

# Use our custom entrypoint that starts both services
ENTRYPOINT ["/opt/cognito/entrypoint.sh"]
