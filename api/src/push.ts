// The push tokens in D1 and the two things the server pushes (docs/CONTRACT.md sections 5 and 8): the "pull now" hint
// to the owner's other devices after a write, and which device gets a server-started Live Activity. No Cloudflare imports.
import type { ApnsEnvironment, ApnsSender, Delivery } from "./apns";
import { backgroundPayload } from "./apns";
import { background } from "./background";

export type PushTokenRow = { id: string; key_id: string; kind: string; token: string; platform: string; env: ApnsEnvironment; activity_id: string | null };

// A dead token (Apple said so) is forgotten everywhere it was stored.
export async function forgetIfDead(db: D1Database, token: string, d: Delivery): Promise<void> {
    if (d.kind === "drop") await db.prepare("DELETE FROM push_tokens WHERE token = ?1").bind(token).run();
}

// The device that gets server-started islands: the newest push-to-start token on an iPhone, else the newest of any
// platform. Only one device: cobalt saw the iPad steal the island from the phone when every device got one.
export async function liveStartTarget(db: D1Database): Promise<PushTokenRow | null> {
    return db
        .prepare(
            `SELECT id, key_id, kind, token, platform, env, activity_id FROM push_tokens WHERE kind = 'live_start'
              ORDER BY CASE WHEN platform = 'ios' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`,
        )
        .first<PushTokenRow>();
}

// The update tokens of the activity showing this job (the app registers them with activity_id = the job id).
export async function liveUpdateTargets(db: D1Database, jobId: string): Promise<PushTokenRow[]> {
    const r = await db
        .prepare("SELECT id, key_id, kind, token, platform, env, activity_id FROM push_tokens WHERE kind = 'live_update' AND activity_id = ?1 ORDER BY updated_at DESC LIMIT 4")
        .bind(jobId)
        .all<PushTokenRow>();
    return r.results;
}

// After a write: a silent push to every device but the caller's own, as a hint to pull. Never holds the answer and
// never fails it.
export function hintOtherDevices(d: { db: D1Database; apns: ApnsSender | null; waitUntil?: (p: Promise<unknown>) => void }, callerKeyId: string | null): Promise<void> {
    const apns = d.apns;
    if (!apns) return Promise.resolve();
    return background(d.waitUntil, async () => {
        const rows = await d.db
            .prepare("SELECT id, key_id, kind, token, platform, env, activity_id FROM push_tokens WHERE kind = 'device' AND key_id IS NOT ?1 LIMIT 20")
            .bind(callerKeyId)
            .all<PushTokenRow>();
        for (const row of rows.results) {
            const delivery = await apns.send({ token: row.token, env: row.env, type: "background", priority: 5, payload: backgroundPayload() });
            await forgetIfDead(d.db, row.token, delivery);
        }
    });
}
