// The 15-minute cron (src/cron.ts): housekeeping on the real schema.
import { describe, expect, it } from "vitest";
import { cleanup } from "../src/cron";
import { IDEMPOTENCY_KEEP_MS } from "../src/sync";
import { world } from "./world";

const count = (w: ReturnType<typeof world>, sql: string) => Number((w.db.raw.prepare(sql).get() as { n: number }).n);

describe("cleanup", () => {
    it("throws away what has run out and keeps the rest", async () => {
        const w = world();
        const now = w.clock.now;
        const live = await w.session("live");
        const dead = await w.session("dead");
        w.db.raw.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?").run(now - 40 * 86400_000, dead.id);
        w.db.raw.prepare("INSERT INTO push_tokens VALUES ('p1', ?, 'device', 'aa', 'ios', 'sandbox', NULL, 0, 0)").run(dead.id);
        w.db.raw.prepare("INSERT INTO push_tokens VALUES ('p2', ?, 'device', 'bb', 'ios', 'sandbox', NULL, 0, 0)").run(live.id);
        w.db.raw.prepare("INSERT INTO auth_handoffs VALUES ('h1', 'c', 'ios', 'd', ?), ('h2', 'c', 'ios', 'd', ?)").run(now - 1, now + 60_000);
        w.db.raw.prepare("INSERT INTO idempotency VALUES ('k1', 'x', 200, '{}', ?), ('k2', 'x', 200, '{}', ?)").run(now - IDEMPOTENCY_KEEP_MS - 1, now);
        w.db.raw.prepare("INSERT INTO jobs VALUES ('j1', 'demo', 'done', 1, 't', NULL, 0, ?), ('j2', 'demo', 'running', 0.5, 't', NULL, 0, ?)").run(now - 8 * 86400_000, now - 3600_000);

        await cleanup(w.db, now);
        expect(count(w, "SELECT COUNT(*) AS n FROM api_keys")).toBe(1);
        expect(count(w, "SELECT COUNT(*) AS n FROM push_tokens")).toBe(1);
        expect(count(w, "SELECT COUNT(*) AS n FROM auth_handoffs")).toBe(1);
        expect(count(w, "SELECT COUNT(*) AS n FROM idempotency")).toBe(1);
        expect(w.db.raw.prepare("SELECT id, state FROM jobs").all().map((r) => ({ ...r }))).toEqual([{ id: "j2", state: "failed" }]);
    });
});
