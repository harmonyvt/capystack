import { readFileSync } from "node:fs";
import adapter from "@sveltejs/adapter-cloudflare";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

// The app's identity comes from ../app.config.json (./init rewrites it); PUBLIC_API_URL overrides the API host at build.
const app = JSON.parse(readFileSync(new URL("../app.config.json", import.meta.url), "utf8")) as { apiHost: string; displayName: string }
const apiUrl = (process.env.PUBLIC_API_URL || `https://${app.apiHost}`) as `https://${string}.${string}`;

export default defineConfig({
	plugins: [
		sveltekit({
			// Output: .svelte-kit/cloudflare/{_worker.js + assets}; cloudflare.config.ts points at it.
			adapter: adapter(),
			// Kit 3 dropped the built-in $lib; this keeps it (one line) so imports read like every SvelteKit app.
			alias: { $lib: "src/lib" },
			// The CSP is the defence against injected script (notes are user text). Hashes cover SvelteKit's own
			// inline bootstrap, so no 'unsafe-inline' for scripts.
			csp: {
				mode: "hash",
				directives: {
					"default-src": ["self"],
					"script-src": ["self", "https://*.i.posthog.com"],
					"style-src": ["self", "unsafe-inline"],
					"img-src": ["self", "data:"],
					// the API host (fetch) and PostHog (lazy)
					"connect-src": ["self", apiUrl, "https://*.i.posthog.com"],
					"font-src": ["self"],
					"object-src": ["none"],
					"base-uri": ["self"],
					"form-action": ["self"],
					"frame-ancestors": ["none"],
				},
			},
		}),
	],
	define: {
		__API_URL__: JSON.stringify(apiUrl),
		__APP_NAME__: JSON.stringify(app.displayName),
	},
	build: { target: "es2022" },
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
	},
});
