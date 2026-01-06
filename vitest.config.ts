import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
	test: {
		include: ["tests/**/*.test.ts"],
		testTimeout: 30000,
		hookTimeout: 60000,
		globalSetup: ["tests/integration/globalSetup.ts"],
		fileParallelism: false,
		env: loadEnv(mode, process.cwd(), ""),
	},
}));
