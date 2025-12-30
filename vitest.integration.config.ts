import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 10000, // 10 seconds per test
    hookTimeout: 30000, // 30 seconds for setup
    globalSetup: ["tests/integration/globalSetup.ts"],
  },
});
