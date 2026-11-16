// Keys for tools (docs/CONTRACT.md section 3): named bearer tokens for MCP clients and scripts, with no expiry until
// revoked. Only a signed-in device (auth "session") may list, make or revoke them: a leaked key can never mint itself a
// spare. The web Worker's /api/keys does the same against the same table.
import * as z from "zod";
import { hashToken, mintToken } from "../../keys";
import { cleanName } from "../../sessions";
import { defineOp, ok, OpError } from "../op";
import { KeyShape, OkShape, Uuid } from "../shapes";

export const MAX_KEYS = 50;

type KeyRow = { id: string; name: string; created_at: number; last_used_at: number | null };

export const keysListOp = defineOp({
    name: "keys.list",
    doc: "The keys for tools.",
    route: { method: "GET", path: "/auth/keys" },
    auth: "session",
    input: z.object({}).loose(),
    output: z.object({ keys: z.array(KeyShape).describe("newest first") }),
    handler: async (ctx) => {
        const rows = await ctx.db
            .prepare("SELECT id, name, created_at, last_used_at FROM api_keys WHERE kind = 'key' AND revoked_at IS NULL ORDER BY created_at DESC, id DESC")
            .all<KeyRow>();
        return ok({ keys: rows.results });
    },
});

export const keysCreateOp = defineOp({
    name: "keys.create",
    doc: "Make a key for tools; its token is shown once.",
    route: { method: "POST", path: "/auth/keys" },
    auth: "session",
    input: z.object({ name: z.string().max(400) }),
    output: z.object({ key: KeyShape, token: z.string().describe("shown once; only its hash is kept") }),
    handler: async (ctx, input) => {
        const name = cleanName(input.name);
        if (!name) throw new OpError(400, "keys.name_invalid", "a name of 1 to 40 characters");
        const count = await ctx.db.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE kind = 'key' AND revoked_at IS NULL").first<{ n: number }>();
        if (Number(count?.n ?? 0) >= MAX_KEYS) throw new OpError(409, "keys.too_many", `at most ${MAX_KEYS} keys`);
        const id = crypto.randomUUID();
        const token = mintToken();
        const now = ctx.now();
        await ctx.db
            .prepare("INSERT INTO api_keys (id, kind, name, token_hash, created_at) VALUES (?1, 'key', ?2, ?3, ?4)")
            .bind(id, name, await hashToken(token), now)
            .run();
        return ok({ key: { id, name, created_at: now, last_used_at: null }, token }, 201);
    },
});

export const keysRevokeOp = defineOp({
    name: "keys.revoke",
    doc: "Revoke a key for tools.",
    route: { method: "DELETE", path: "/auth/keys/:id" },
    auth: "session",
    input: z.object({ id: Uuid }),
    output: OkShape,
    handler: async (ctx, input) => {
        const r = await ctx.db
            .prepare("UPDATE api_keys SET revoked_at = ?1 WHERE id = ?2 AND kind = 'key' AND revoked_at IS NULL")
            .bind(ctx.now(), input.id)
            .run();
        if (!r.meta.changes) throw new OpError(404, "keys.not_found");
        return ok({ ok: true });
    },
});

export const KEY_OPS = [keysListOp, keysCreateOp, keysRevokeOp];
