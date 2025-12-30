# Multi-stage build: Build the TypeScript app first
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source and build
COPY src/ ./src/
RUN npm run build

# Production stage: Keycloak + Node.js + supervisord
FROM quay.io/keycloak/keycloak:26.0 AS keycloak

# Switch to root for package installation
USER root

# Install Node.js, npm, and supervisord
RUN microdnf install -y nodejs npm python3 python3-pip && \
    pip3 install supervisor && \
    microdnf clean all

# Create app directory
WORKDIR /app

# Copy built app from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy configuration files
COPY supervisord.conf /etc/supervisord.conf
COPY scripts/setup-keycloak.sh /opt/scripts/setup-keycloak.sh
RUN chmod +x /opt/scripts/setup-keycloak.sh

# Set environment variables
ENV KEYCLOAK_ADMIN=admin
ENV KEYCLOAK_ADMIN_PASSWORD=admin
ENV KEYCLOAK_URL=http://localhost:8080
ENV PORT=3000
ENV USER_POOL_ID=local_pool

# Expose ports
# 3000 - Cognito API
# 8080 - Keycloak
EXPOSE 3000 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start supervisord
CMD ["/usr/local/bin/supervisord", "-c", "/etc/supervisord.conf"]

