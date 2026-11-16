// The token check (src/keys.ts): a session's 90-day expiry slides with use, written at most once a day, and the
// per-isolate cache.
import { describe, expect, it } from "vitest";
import { KeyCache, lookupToken, SESSION_TTL_MS, SLIDE_EVERY_MS } from "../src/keys";
import { world } from "./world";

const DAY = 86400_000;

describe("session sliding expiry", () => {
    it("slides the expiry at most once a day", async () => {
        const w = world();
        const s = await w.session();
        const expiresAt = () => Number((w.db.raw.prepare("SELECT expires_at FROM api_keys WHERE id = ?").get(s.id) as { expires_at: number }).expires_at);
        const start = expiresAt();
        w.clock.now += 3 * 60 * 60 * 1000;
        expect(await lookupToken(w.db, s.token, w.clock.now)).toEqual({ id: s.id, kind: "session" });
        expect(expiresAt()).toBe(start); // less than a day: no write
        w.clock.now += SLIDE_EVERY_MS;
        await lookupToken(w.db, s.token, w.clock.now);
        expect(expiresAt()).toBe(w.clock.now + SESSION_TTL_MS);
    });

    it("refuses a session past its expiry, and a used one lives on", async () => {
        const w = world();
        const idle = await w.session("idle");
        const busy = await w.session("busy");
        for (let d = 0; d < 100; d += 10) {
            w.clock.now += 10 * DAY;
            await lookupToken(w.db, busy.token, w.clock.now);
        }
        expect(await lookupToken(w.db, idle.token, w.clock.now)).toBeNull();
        expect(await lookupToken(w.db, busy.token, w.clock.now)).not.toBeNull();
        expect((await w.json("GET", "/notes", { token: idle.token })).status).toBe(401);
    });

    it("keys for tools never expire", async () => {
        const w = world();
        const k = await w.key();
        w.clock.now += 1000 * DAY;
        expect(await lookupToken(w.db, k.token, w.clock.now)).toEqual({ id: k.id, kind: "key" });
    });

    it("answers from the cache for a minute without asking D1", async () => {
        const w = world();
        const s = await w.session();
        const cache = new KeyCache();
        await lookupToken(w.db, s.token, w.clock.now, cache);
        w.db.breakIt();
        expect(await lookupToken(w.db, s.token, w.clock.now + 30_000, cache)).toEqual({ id: s.id, kind: "session" });
        await expect(lookupToken(w.db, s.token, w.clock.now + 61_000, cache)).rejects.toThrow(/outage/);
    });

    it("fails closed with 503 when D1 is down", async () => {
        const w = world();
        const s = await w.session();
        w.db.breakIt();
        expect(await w.json("GET", "/notes", { token: s.token })).toMatchObject({ status: 503, body: { error: "unavailable" } });
    });
});
