// PostHog (src/posthog.ts): one `op` event per call with {op, status, ms, via}, distinct_id = the key id, never a token;
// off without a token; a 5xx also becomes an $exception.
import { describe, expect, it, vi } from "vitest";
import { capture, cronEvent, opEvents, postHogConfig, sendBatch } from "../src/posthog";
import { world } from "./world";

describe("posthog", () => {
    it("is off without a token", () => {
        expect(postHogConfig({ POSTHOG_TOKEN: " " })).toBeNull();
        expect(postHogConfig({ POSTHOG_TOKEN: "phc", POSTHOG_HOST: "https://eu.i.posthog.com/" })).toEqual({ token: "phc", host: "https://eu.i.posthog.com" });
    });

    it("builds op events, with an exception for a 5xx", () => {
        const [op, ex] = opEvents({ op: "notes.list", status: 500, ms: 12.4, via: "http", keyId: "k1", error: "internal" }, 0);
        expect(op).toMatchObject({ event: "op", distinct_id: "k1", properties: { op: "notes.list", status: 500, ms: 12, via: "http", ok: false } });
        expect(ex!.event).toBe("$exception");
        expect(opEvents({ op: "x", status: 200, ms: 1, via: "mcp", keyId: null }, 0)).toHaveLength(1);
        expect(cronEvent("cleanup", 0, 5, true).properties).toMatchObject({ job: "cleanup", ok: true });
    });

    it("sends one event per HTTP call, without the token", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
        try {
            const w = world({ env: { POSTHOG_TOKEN: "phc_test" } });
            const { id, token } = await w.session();
            await w.call("GET", "/notes", { token });
            const sent = fetchSpy.mock.calls.map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) }));
            const ops = sent.flatMap((s) => s.body.batch).filter((e: any) => e.event === "op");
            expect(sent[0]!.url).toBe("https://us.i.posthog.com/batch/");
            expect(ops).toMatchObject([{ distinct_id: id, properties: { op: "notes.list", status: 200, via: "http" } }]);
            expect(JSON.stringify(sent)).not.toContain(token);
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it("never fails the caller when PostHog is down", async () => {
        expect(await sendBatch({ token: "t", host: "https://x" }, [cronEvent("c", 0, 1, true)], async () => Promise.reject(new Error("down")))).toBe(false);
        await expect(capture({ POSTHOG_TOKEN: "t" }, undefined, [cronEvent("c", 0, 1, true)], async () => Promise.reject(new Error("down")))).resolves.toBeUndefined();
    });
});
