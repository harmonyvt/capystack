// Anthropic calls go out through the ModelRelay Durable Object (src/model-relay.ts), pinned to North America. Copied
// from cobalt: a Worker's own fetch leaves from whichever Cloudflare location took the request, and from some of them
// (HKG, SIN seen live) Anthropic answers 403 "Request not allowed" while the same key works elsewhere. No Cloudflare
// imports, so tests load it under node.
import type { DoNamespace } from "./env";

export const RELAY_URL_HEADER = "x-model-relay-url";
// One relay object; the name only has to stay the same. The location hint is used when it is first created.
export const RELAY_NAME = "anthropic";
export const RELAY_LOCATION = "enam";
// Where the relay may forward to: the Anthropic API and Cloudflare AI Gateway. Anything else is refused, so the relay
// can never be used to reach an arbitrary host with our key.
export const RELAY_HOSTS = ["api.anthropic.com", "gateway.ai.cloudflare.com"];

export type ModelFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

// A fetch for the Anthropic SDK (its `fetch` option) that hands every request to the relay.
export function relayFetch(ns: DoNamespace): ModelFetch {
    return async (input, init) => {
        const req = new Request(input, init);
        const headers = new Headers(req.headers);
        headers.set(RELAY_URL_HEADER, req.url);
        const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
        const stub = ns.get(ns.idFromName(RELAY_NAME), { locationHint: RELAY_LOCATION });
        return stub.fetch(new Request("https://model-relay.internal/", { method: req.method, headers, body }));
    };
}

// The relay's side: the request to send upstream, or null when the target is missing or not allowed.
export function upstreamRequest(request: Request, body: ArrayBuffer | undefined): Request | null {
    const target = request.headers.get(RELAY_URL_HEADER);
    if (!target) return null;
    let url: URL;
    try {
        url = new URL(target);
    } catch {
        return null;
    }
    if (url.protocol !== "https:" || !RELAY_HOSTS.includes(url.hostname) || url.port !== "") return null;
    const headers = new Headers(request.headers);
    headers.delete(RELAY_URL_HEADER);
    return new Request(url, { method: request.method, headers, body });
}
