import type { Handle } from "@sveltejs/kit/hooks";

// Security headers on every dynamic response. Static assets get theirs from the adapter's _headers file
// (immutable build output: `public, immutable, max-age=31536000`). Cloudflare Access sits in front of everything.
export const handle: Handle = async ({ event, resolve }) => {
	const res = await resolve(event);
	const h = res.headers;
	h.set("x-content-type-options", "nosniff");
	h.set("referrer-policy", "same-origin");
	h.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
	if (event.url.pathname.startsWith("/api/")) h.set("cache-control", h.get("cache-control") ?? "no-store");
	return res;
};
