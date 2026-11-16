// Accounts (docs/CONTRACT.md section 3), as cobalt's registry/ops/auth.ts: the app's sign-in exchange, who am I, the
// signed-in devices, and sign out. Never chat or MCP tools. Tokens and codes are never logged and never stored in
// plaintext (only their SHA-256).
//  - POST /auth/exchange: open. Trades the one-time code the web Worker's /api/auth/app handed the app (PKCE S256) for a
//    session. Every failure is the same 400 auth.code_invalid, so nobody learns whether a code existed or the verifier
//    was wrong, and the code is deleted on the first try whatever the outcome.
import * as z from "zod";
import { base64url, hashToken } from "../../keys";
import { ACTIVE_SESSION_SQL, cleanName, isPlatform, mintSession, SESSION_COLUMNS, sessionBody, type SessionRow } from "../../sessions";
import { defineOp, ok, OpError, type OpContext } from "../op";
import { OkShape, SessionRowShape, SessionShape, Uuid } from "../shapes";

const CODE_INVALID = "auth.code_invalid";
const CODE_REGEX = /^[A-Za-z0-9_-]{16,128}$/;
// RFC 7636: 43..128 unreserved characters
const VERIFIER_REGEX = /^[A-Za-z0-9._~-]{43,128}$/;

// PKCE S256: base64url(SHA-256(verifier)), no padding.
export async function challengeOf(verifier: string): Promise<string> {
    return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

async function callerRow(ctx: OpContext): Promise<SessionRow | null> {
    return ctx.db.prepare(`SELECT ${SESSION_COLUMNS} FROM api_keys WHERE id = ?1`).bind(ctx.caller!.id).first<SessionRow>();
}

export const exchangeOp = defineOp({
    name: "auth.exchange",
    doc: "Trade the one-time sign-in code and its PKCE verifier for a device session.",
    route: { method: "POST", path: "/auth/exchange" },
    auth: "open",
    input: z.object({
        code: z.string().max(256),
        verifier: z.string().max(256),
        device: z.string().max(400).optional(),
        platform: z.string().max(20).optional(),
    }),
    badRequest: CODE_INVALID,
    output: z.object({ token: z.string().describe("send as Authorization: Bearer <token>; shown once"), session: SessionShape }),
    handler: async (ctx, input) => {
        if (!CODE_REGEX.test(input.code) || !VERIFIER_REGEX.test(input.verifier)) throw new OpError(400, CODE_INVALID);
        const now = ctx.now();
        // One statement takes the code away, so a second try (or a racing one) finds nothing.
        const handoff = await ctx.db
            .prepare("DELETE FROM auth_handoffs WHERE code_hash = ?1 RETURNING challenge, platform, device, expires_at")
            .bind(await hashToken(input.code))
            .first<{ challenge: string; platform: string; device: string; expires_at: number }>();
        if (!handoff || handoff.expires_at <= now || handoff.challenge !== (await challengeOf(input.verifier))) throw new OpError(400, CODE_INVALID);
        const platform = isPlatform(handoff.platform) ? handoff.platform : isPlatform(input.platform) ? input.platform : null;
        const device = cleanName(input.device) ?? cleanName(handoff.device);
        if (!platform || !device) throw new OpError(400, CODE_INVALID);
        const minted = await mintSession(ctx.db, { device, platform }, now);
        return ok({ token: minted.token, session: minted.session });
    },
});

export const meOp = defineOp({
    name: "auth.me",
    doc: "The calling session or key.",
    route: { method: "GET", path: "/auth/me" },
    auth: "key",
    input: z.object({}).loose(),
    output: z.object({ session: SessionShape }),
    handler: async (ctx) => {
        const row = await callerRow(ctx);
        if (!row) throw new OpError(401, "auth.required");
        return ok({ session: sessionBody(row) });
    },
});

export const sessionsOp = defineOp({
    name: "auth.sessions",
    doc: "The signed-in devices, the caller's marked current.",
    route: { method: "GET", path: "/auth/sessions" },
    auth: "session",
    input: z.object({}).loose(),
    output: z.object({ sessions: z.array(SessionRowShape).describe("most recently used first") }),
    handler: async (ctx) => {
        const rows = await ctx.db
            .prepare(`SELECT ${SESSION_COLUMNS} FROM api_keys WHERE ${ACTIVE_SESSION_SQL} ORDER BY last_used_at DESC, created_at DESC LIMIT 100`)
            .bind(ctx.now())
            .all<SessionRow>();
        return ok({ sessions: rows.results.map((r) => ({ ...sessionBody(r), current: r.id === ctx.caller!.id })) });
    },
});

export const revokeOp = defineOp({
    name: "auth.revoke",
    doc: "Sign a device out.",
    route: { method: "DELETE", path: "/auth/sessions/:id" },
    auth: "session",
    input: z.object({ id: Uuid }),
    output: OkShape,
    handler: async (ctx, input) => {
        const r = await ctx.db
            .prepare("UPDATE api_keys SET revoked_at = ?1 WHERE id = ?2 AND kind = 'session' AND revoked_at IS NULL")
            .bind(ctx.now(), input.id)
            .run();
        if (!r.meta.changes) throw new OpError(404, "auth.session_not_found");
        await ctx.db.prepare("DELETE FROM push_tokens WHERE key_id = ?1").bind(input.id).run();
        return ok({ ok: true });
    },
});

export const signoutOp = defineOp({
    name: "auth.signout",
    doc: "Sign the caller out (revokes its own token).",
    route: { method: "POST", path: "/auth/signout" },
    auth: "key",
    input: z.object({}).loose(),
    output: OkShape,
    handler: async (ctx) => {
        await ctx.db.prepare("UPDATE api_keys SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL").bind(ctx.now(), ctx.caller!.id).run();
        // a signed-out device gets no more pushes
        await ctx.db.prepare("DELETE FROM push_tokens WHERE key_id = ?1").bind(ctx.caller!.id).run();
        return ok({ ok: true });
    },
});

export const AUTH_OPS = [exchangeOp, meOp, sessionsOp, revokeOp, signoutOp];
