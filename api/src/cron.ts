// The 15-minute cron (docs/CONTRACT.md section 2): housekeeping only, a few indexed statements when there is nothing to
// do. Delete markers past 30 days (sync.ts), idempotency rows past 7 days, expired sign-in codes, finished jobs past
// 7 days, sessions that expired or were revoked more than 30 days ago, and the push tokens of keys that no longer work.
// Each run is one PostHog `cron_run` event. No Cloudflare imports.
import { capture, cronEvent } from "./posthog";
import { GONE_KEEP_MS, IDEMPOTENCY_KEEP_MS, trimGoneMarkers } from "./sync";
import type { Env } from "./env";

const DAY = 24 * 60 * 60 * 1000;

export async function cleanup(db: D1Database, now: number): Promise<{ trimmed_seq: number }> {
    const trimmed = await trimGoneMarkers(db, now - GONE_KEEP_MS);
    await db.batch([
        db.prepare("DELETE FROM idempotency WHERE created_at < ?1").bind(now - IDEMPOTENCY_KEEP_MS),
        db.prepare("DELETE FROM auth_handoffs WHERE expires_at < ?1").bind(now),
        db.prepare("DELETE FROM jobs WHERE state <> 'running' AND updated_at < ?1").bind(now - 7 * DAY),
        // a job whose runner died (it would have finished in at most 2 minutes)
        db.prepare("UPDATE jobs SET state = 'failed', updated_at = ?1 WHERE state = 'running' AND updated_at < ?2").bind(now, now - 15 * 60 * 1000),
        db.prepare(
            "DELETE FROM push_tokens WHERE key_id NOT IN (SELECT id FROM api_keys WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?1))",
        ).bind(now),
        db.prepare("DELETE FROM api_keys WHERE (revoked_at IS NOT NULL AND revoked_at < ?1) OR (expires_at IS NOT NULL AND expires_at < ?1)").bind(now - 30 * DAY),
    ]);
    return { trimmed_seq: trimmed };
}

export async function runCron(env: Env, now: () => number, waitUntil?: (p: Promise<unknown>) => void): Promise<void> {
    const started = now();
    let ok = true;
    let detail: Record<string, unknown> = {};
    try {
        detail = await cleanup(env.DB, started);
    } catch (e) {
        ok = false;
        console.error("[cron] cleanup failed", e instanceof Error ? e.message : String(e));
    }
    await capture(env, waitUntil, [cronEvent("cleanup", now(), now() - started, ok, detail)]);
}
