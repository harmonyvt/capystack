// ModelRelay (src/model-fetch.ts): what the Worker hands the relay, and what the relay agrees to forward.
import { describe, expect, it } from "vitest";
import { RELAY_LOCATION, RELAY_NAME, RELAY_URL_HEADER, relayFetch, upstreamRequest } from "../src/model-fetch";

const relayReq = (target: string | null) => new Request("https://model-relay.internal/", { method: "POST", headers: target ? { [RELAY_URL_HEADER]: target, "x-api-key": "k" } : {} });

describe("the relay's allowlist", () => {
    it("forwards to the Anthropic API and AI Gateway only", () => {
        const up = upstreamRequest(relayReq("https://api.anthropic.com/v1/messages"), new ArrayBuffer(0));
        expect(up?.url).toBe("https://api.anthropic.com/v1/messages");
        expect(up?.headers.get(RELAY_URL_HEADER)).toBeNull();
        expect(up?.headers.get("x-api-key")).toBe("k");
        expect(upstreamRequest(relayReq("https://gateway.ai.cloudflare.com/v1/a/b/anthropic/v1/messages"), undefined)).not.toBeNull();
    });

    it("refuses anything else", () => {
        for (const t of [null, "not a url", "http://api.anthropic.com/v1/messages", "https://evil.example/v1", "https://api.anthropic.com.evil.example/", "https://api.anthropic.com:8443/v1"]) {
            expect(upstreamRequest(relayReq(t), undefined)).toBeNull();
        }
    });
});

describe("relayFetch", () => {
    it("hands the request to the one relay object, pinned to enam, with the target in a header", async () => {
        const seen: { name?: string; hint?: string; req?: Request; body?: string } = {};
        const ns = {
            idFromName: (n: string) => ((seen.name = n), `id:${n}`),
            get: (_id: unknown, o?: { locationHint?: string }) => {
                seen.hint = o?.locationHint;
                return { fetch: async (r: Request) => ((seen.req = r), (seen.body = await r.text()), new Response("{}")) };
            },
        };
        await relayFetch(ns)("https://api.anthropic.com/v1/messages", { method: "POST", body: '{"a":1}', headers: { "x-api-key": "k" } });
        expect(seen).toMatchObject({ name: RELAY_NAME, hint: RELAY_LOCATION, body: '{"a":1}' });
        expect(seen.req!.headers.get(RELAY_URL_HEADER)).toBe("https://api.anthropic.com/v1/messages");
        expect(seen.req!.headers.get("x-api-key")).toBe("k");
    });
});
