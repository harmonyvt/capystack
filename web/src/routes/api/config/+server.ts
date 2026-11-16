import type { RequestHandler } from "./$types";
import { env } from "cloudflare:workers";
import type { Env } from "$lib/server/env";

export const prerender = false;

// Runtime settings the prerendered pages cannot know: the API host and the (public-safe) PostHog token.
// Behind Access like the rest of the site; cached for five minutes in the browser.
export const GET: RequestHandler = () => {
	const e = env as unknown as Env;
	return new Response(
		JSON.stringify({ apiUrl: e.API_URL, posthog: e.POSTHOG_TOKEN ? { host: e.POSTHOG_HOST, token: e.POSTHOG_TOKEN } : null }),
		{ headers: { "content-type": "application/json", "cache-control": "private, max-age=300" } },
	);
};
