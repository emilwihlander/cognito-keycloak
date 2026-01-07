# Build the TypeScript app
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json ./
COPY tsconfig.json ./
COPY bun.lockb ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source and build
COPY src/ ./src/
RUN bun run build

# Production image - Node.js only
FROM node:22-alpine

WORKDIR /app

# Copy built app from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Set environment variables
ENV KEYCLOAK_URL=http://keycloak:8080
ENV KEYCLOAK_REALM=cognito
ENV PORT=8081
ENV USER_POOL_ID=local_pool

# Expose port
EXPOSE 8081

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8081/health || exit 1

# Start the app
CMD ["node", "dist/index.js"]
