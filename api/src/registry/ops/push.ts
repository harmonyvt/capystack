// Push tokens (docs/CONTRACT.md section 8): the app registers its APNs device token, its push-to-start token, and each
// Live Activity's update token (activity_id = the job id the activity shows). One row per key + kind (+ activity); the
// same token under another key (the device signed in again) is moved, never kept twice.
import * as z from "zod";
import { defineOp, ok, OpError } from "../op";
import { OkShape, PushTokenShape, Uuid } from "../shapes";

type Row = { id: string; kind: string; platform: string; env: string; activity_id: string | null; created_at: number; updated_at: number };

export const pushRegisterOp = defineOp({
    name: "push.register",
    doc: "Register an APNs device, push-to-start or Live Activity update token.",
    route: { method: "POST", path: "/push/tokens" },
    auth: "key",
    input: z.object({
        kind: z.enum(["device", "live_start", "live_update"]),
        token: z.string().regex(/^[0-9A-Fa-f]{16,400}$/, "the APNs token as hex"),
        platform: z.enum(["ios", "ipados", "mac"]),
        env: z.enum(["sandbox", "production"]),
        activity_id: z.string().min(1).max(100).optional(),
    }),
    output: z.object({ token: PushTokenShape }),
    handler: async (ctx, input) => {
        if (input.kind === "live_update" && !input.activity_id) throw new OpError(400, "bad_request", "live_update needs activity_id (the job id)");
        const activity = input.kind === "live_update" ? input.activity_id! : null;
        const token = input.token.toLowerCase();
        const keyId = ctx.caller!.id;
        const now = ctx.now();
        const existing = await ctx.db
            .prepare("SELECT id, created_at FROM push_tokens WHERE key_id = ?1 AND kind = ?2 AND activity_id IS ?3")
            .bind(keyId, input.kind, activity)
            .first<{ id: string; created_at: number }>();
        const id = existing?.id ?? crypto.randomUUID();
        const createdAt = existing?.created_at ?? now;
        await ctx.db.batch([
            // the same token anywhere else (an older sign-in on this device) goes
            ctx.db.prepare("DELETE FROM push_tokens WHERE token = ?1 AND kind = ?2 AND id <> ?3").bind(token, input.kind, id),
            existing
                ? ctx.db.prepare("UPDATE push_tokens SET token = ?2, platform = ?3, env = ?4, updated_at = ?5 WHERE id = ?1").bind(id, token, input.platform, input.env, now)
                : ctx.db
                      .prepare(
                          "INSERT INTO push_tokens (id, key_id, kind, token, platform, env, activity_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                      )
                      .bind(id, keyId, input.kind, token, input.platform, input.env, activity, now),
        ]);
        const row: Row = { id, kind: input.kind, platform: input.platform, env: input.env, activity_id: activity, created_at: createdAt, updated_at: now };
        return ok({ token: row }, existing ? 200 : 201);
    },
});

export const pushUnregisterOp = defineOp({
    name: "push.unregister",
    doc: "Forget a push token.",
    route: { method: "DELETE", path: "/push/tokens/:id" },
    auth: "key",
    input: z.object({ id: Uuid }),
    output: OkShape,
    handler: async (ctx, input) => {
        const r = await ctx.db.prepare("DELETE FROM push_tokens WHERE id = ?1 AND key_id = ?2").bind(input.id, ctx.caller!.id).run();
        if (!r.meta.changes) throw new OpError(404, "push.not_found");
        return ok({ ok: true });
    },
});

export const PUSH_OPS = [pushRegisterOp, pushUnregisterOp];
