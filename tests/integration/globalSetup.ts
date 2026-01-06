import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import app from "../../src/app.js";

let server: ServerType | null = null;

export async function setup() {
	// Start the Hono server on port 9000
	server = serve({
		fetch: app.fetch,
		port: 9000,
	});

	// Wait for server to be ready
	const maxRetries = 50;
	for (let i = 0; i < maxRetries; i++) {
		try {
			const response = await fetch("http://localhost:9000/health");
			if (response.ok) {
				console.log("\n✓ Cognito API server started on port 9000\n");
				return;
			}
		} catch {
			// Server not ready yet
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("Server failed to start");
}

export async function teardown() {
	if (server) {
		server.close();
		server = null;
	}
}
