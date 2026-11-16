// Sign-in (docs/CONTRACT.md section 3): the app's PKCE exchange, who am I, the device list, revoke and sign out.
import { describe, expect, it } from "vitest";
import { hashToken } from "../src/keys";
import { MAX_SESSIONS } from "../src/sessions";
import { challengeOf } from "../src/registry/ops/auth";
import { world, type World } from "./world";

const VERIFIER = "v".repeat(20) + "-._~" + "A1b2C3d4e5F6g7H8i9J0k".slice(0, 20); // 44 chars
const CODE = "code_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab";

// What the web Worker's /api/auth/app writes.
async function handoff(w: World, o: { code?: string; verifier?: string; expires?: number; platform?: string; device?: string } = {}) {
    await w.db
        .prepare("INSERT INTO auth_handoffs (code_hash, challenge, platform, device, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(await hashToken(o.code ?? CODE), await challengeOf(o.verifier ?? VERIFIER), o.platform ?? "ios", o.device ?? "harmony's iphone", o.expires ?? w.clock.now + 120_000)
        .run();
}

describe("POST /auth/exchange", () => {
    it("trades a code and its verifier for a session token that works", async () => {
        const w = world();
        await handoff(w);
        const r = await w.json("POST", "/auth/exchange", { body: { code: CODE, verifier: VERIFIER, device: "harmony's iphone", platform: "ios" } });
        expect(r.status).toBe(200);
        expect(r.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(r.body.session).toMatchObject({ kind: "session", device: "harmony's iphone", platform: "ios", expires_at: w.clock.now + 90 * 86400_000 });
        const me = await w.json("GET", "/auth/me", { token: r.body.token });
        expect(me.status).toBe(200);
        expect(me.body.session.id).toBe(r.body.session.id);
        // only the hash is stored
        const row = w.db.raw.prepare("SELECT token_hash FROM api_keys WHERE id = ?").get(r.body.session.id) as { token_hash: string };
        expect(row.token_hash).toBe(await hashToken(r.body.token));
    });

    it("refuses a wrong verifier, and the code is gone after that one try", async () => {
        const w = world();
        await handoff(w);
        const bad = await w.json("POST", "/auth/exchange", { body: { code: CODE, verifier: "x".repeat(43) } });
        expect(bad).toMatchObject({ status: 400, body: { error: "auth.code_invalid" } });
        const again = await w.json("POST", "/auth/exchange", { body: { code: CODE, verifier: VERIFIER } });
        expect(again).toMatchObject({ status: 400, body: { error: "auth.code_invalid" } });
    });

    it("refuses an expired code and a second use", async () => {
        const w = world();
        await handoff(w, { expires: w.clock.now - 1 });
        expect((await w.json("POST", "/auth/exchange", { body: { code: CODE, verifier: VERIFIER } })).status).toBe(400);
        await handoff(w, { code: CODE + "2" });
        expect((await w.json("POST", "/auth/exchange", { body: { code: CODE + "2", verifier: VERIFIER } })).status).toBe(200);
        expect((await w.json("POST", "/auth/exchange", { body: { code: CODE + "2", verifier: VERIFIER } })).status).toBe(400);
    });

    it("refuses malformed input with the same answer", async () => {
        const w = world();
        expect(await w.json("POST", "/auth/exchange", { body: { code: "short", verifier: VERIFIER } })).toMatchObject({ status: 400, body: { error: "auth.code_invalid" } });
    });

    it("keeps at most 50 sessions, revoking the least recently used", async () => {
        const w = world();
        for (let i = 0; i < MAX_SESSIONS + 2; i++) {
            w.clock.now += 1000;
            await handoff(w, { code: `${CODE}${i}` });
            expect((await w.json("POST", "/auth/exchange", { body: { code: `${CODE}${i}`, verifier: VERIFIER } })).status).toBe(200);
        }
        const active = w.db.raw.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE kind = 'session' AND revoked_at IS NULL").get() as { n: number };
        expect(Number(active.n)).toBe(MAX_SESSIONS);
    });
});

describe("the account routes", () => {
    it("lists sessions with the caller marked, revokes one, and signs out", async () => {
        const w = world();
        const phone = await w.session("phone", "ios");
        const mac = await w.session("mac", "mac");
        const list = await w.json("GET", "/auth/sessions", { token: phone.token });
        expect(list.status).toBe(200);
        expect(list.body.sessions).toHaveLength(2);
        expect(list.body.sessions.find((s: any) => s.id === phone.id).current).toBe(true);

        expect((await w.json("DELETE", `/auth/sessions/${mac.id}`, { token: phone.token })).status).toBe(200);
        expect((await w.json("GET", "/auth/me", { token: mac.token })).body).toEqual({ error: "auth.required" });
        expect((await w.json("DELETE", `/auth/sessions/${mac.id}`, { token: phone.token })).status).toBe(404);

        expect((await w.json("POST", "/auth/signout", { token: phone.token })).status).toBe(200);
        expect((await w.json("GET", "/auth/me", { token: phone.token })).status).toBe(401);
    });

    it("keeps a key for tools out of the session-only routes", async () => {
        const w = world();
        const key = await w.key();
        expect(await w.json("GET", "/auth/sessions", { token: key.token })).toMatchObject({ status: 403, body: { error: "auth.session_required" } });
        expect((await w.json("POST", "/auth/keys", { token: key.token, body: { name: "spare" } })).status).toBe(403);
        // but it may ask who it is
        expect((await w.json("GET", "/auth/me", { token: key.token })).body.session).toMatchObject({ kind: "key", expires_at: null });
    });

    it("answers 401 auth.required without a token or with a bad one", async () => {
        const w = world();
        expect(await w.json("GET", "/auth/me")).toMatchObject({ status: 401, body: { error: "auth.required" } });
        expect((await w.json("GET", "/auth/me", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
        expect((await w.json("GET", "/auth/me", { token: "A".repeat(43) })).status).toBe(401);
    });
});
