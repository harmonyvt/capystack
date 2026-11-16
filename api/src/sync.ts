// The server half of sync (docs/CONTRACT.md section 5), CloudKit's design against D1 as in cobalt's api/src/sync.ts:
// triggers on `notes` keep one row per thing in `changes` (migration 0001), GET /sync pages through it in one D1 batch,
// and the write routes honour Idempotency-Key and answer the change number they produced (x-change-seq).
// No Cloudflare imports.
import { OpError, type OpReply } from "./registry/op";

export const CHANGE_SEQ_HEADER = "x-change-seq";
export const IDEMPOTENCY_HEADER = "idempotency-key";
export const SYNC_LIMIT = 500;
// Delete markers older than this are dropped by the cron; a client still behind one gets 410 sync.too_old.
export const GONE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_KEY_MAX = 200;
// A first load's cursor while it has more pages and something was trimmed (see walkCursor). Plain change numbers stay
// far below this.
export const WALK_BASE = 1_000_000_000;

export type Note = { id: string; title: string; body: string; created_at: number; updated_at: number };
export type SyncPage = { since: number; next: number; more: boolean; notes: Note[]; gone: { entity: string; id: string }[] };

type ChangeRow = { seq: number; entity: string; id: string; gone: number };

export function parseSince(raw: string | null | undefined): number | null {
    if (raw === null || raw === undefined || raw === "") return 0;
    if (!/^\d{1,16}$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
}

// A first load (since = 0) that has more pages reads rows whose numbers can be below trimmed_seq, and a plain cursor
// there could not be told from a device that synced before the trim (which must be refused). So such a cursor carries
// the trimmed_seq it was read under: trimmed * WALK_BASE + seq. It stays good while nothing more is trimmed; after
// another trim it is refused like any stale cursor and the device starts again (cobalt's walkCursor, same reasoning).
const walkCursor = (trimmed: number, seq: number, head: number): number | null =>
    trimmed > 0 && seq < trimmed && head < WALK_BASE && trimmed < Math.floor(Number.MAX_SAFE_INTEGER / WALK_BASE) ? trimmed * WALK_BASE + seq : null;

// GET /sync?since=N. One db.batch; the statements do not need each other's rows.
export async function syncPage(db: D1Database, since: number, limit = SYNC_LIMIT): Promise<SyncPage> {
    const take = limit + 1;
    const read = (from: number) =>
        db.batch([
            db.prepare("SELECT trimmed_seq FROM sync_state WHERE id = 1"),
            db.prepare("SELECT seq, entity, id, gone FROM changes WHERE seq > ?1 ORDER BY seq LIMIT ?2").bind(from, take),
            db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM changes"),
            db
                .prepare(
                    `SELECT id, title, body, created_at, updated_at FROM notes WHERE id IN
                       (SELECT id FROM (SELECT seq, entity, id, gone FROM changes WHERE seq > ?1 ORDER BY seq LIMIT ?2)
                         WHERE entity = 'note' AND gone = 0)`,
                )
                .bind(from, take),
        ]);
    const head = (rows: D1Result[]) => ({
        trimmed: Number((rows[0]?.results?.[0] as { trimmed_seq?: number } | undefined)?.trimmed_seq ?? 0),
        high: Number((rows[2]?.results?.[0] as { seq?: number } | undefined)?.seq ?? 0),
    });
    let walking = since >= WALK_BASE;
    let from = walking ? since % WALK_BASE : since;
    let rows = await read(from);
    // a cursor that big but not above the head is a plain number after all (the log grew past WALK_BASE)
    if (walking && since <= Math.max(head(rows).high, head(rows).trimmed)) {
        walking = false;
        from = since;
        rows = await read(from);
    }
    const { trimmed, high } = head(rows);
    const top = Math.max(high, trimmed);
    const stale = walking ? Math.floor(since / WALK_BASE) !== trimmed : from > 0 && from < trimmed;
    // Above the head: not a cursor this log handed out (the database was reset or restored): start again too.
    if (stale || from > top) throw new OpError(410, "sync.too_old", "start again from 0");

    const fetched = (rows[1]?.results ?? []) as ChangeRow[];
    const more = fetched.length > limit;
    const page = fetched.slice(0, limit);
    const last = page.length > 0 ? Number(page[page.length - 1]!.seq) : Math.max(from, high);
    const firstLoad = walking || from === 0;
    const next = more ? ((firstLoad ? walkCursor(trimmed, last, top) : null) ?? last) : Math.max(last, trimmed);

    const live = new Set(page.filter((r) => r.entity === "note" && r.gone === 0).map((r) => r.id));
    const notes = ((rows[3]?.results ?? []) as Note[]).filter((n) => live.has(n.id)).map(noteBody);
    const found = new Set(notes.map((n) => n.id));
    const gone = [
        ...page.filter((r) => r.gone === 1).map((r) => ({ entity: r.entity, id: r.id })),
        // a row the log says is live but the read did not find (deleted between the statements): gone
        ...[...live].filter((id) => !found.has(id)).map((id) => ({ entity: "note", id })),
    ];
    return { since, next, more, notes, gone };
}

export const noteBody = (r: Note): Note => ({ id: r.id, title: r.title, body: r.body, created_at: Number(r.created_at), updated_at: Number(r.updated_at) });

// The cron: throw away delete markers older than `before` and remember the highest seq removed.
export async function trimGoneMarkers(db: D1Database, before: number): Promise<number> {
    const row = await db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM changes WHERE gone = 1 AND at < ?1").bind(before).first<{ seq: number }>();
    const seq = Number(row?.seq ?? 0);
    if (seq > 0) {
        await db.batch([
            db.prepare("UPDATE sync_state SET trimmed_seq = MAX(trimmed_seq, ?1) WHERE id = 1").bind(seq),
            db.prepare("DELETE FROM changes WHERE gone = 1 AND seq <= ?1").bind(seq),
        ]);
    }
    const now = await db.prepare("SELECT trimmed_seq FROM sync_state WHERE id = 1").first<{ trimmed_seq: number }>();
    return Number(now?.trimmed_seq ?? 0);
}

// The newest change number.
export async function changeSeq(db: D1Database): Promise<number> {
    const row = await db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM changes").first<{ seq: number }>();
    return Number(row?.seq ?? 0);
}

// ---- Idempotency-Key ------------------------------------------------------------------------------------------------
// A repeated key from the same credential replays the first 2xx answer and does not run the write again. A key over
// the limit is refused, not ignored: the caller believes its retries are safe.

export function idempotencyKeyOf(request: Request | undefined): string | null {
    const key = request?.headers.get(IDEMPOTENCY_HEADER)?.trim() ?? "";
    if (key === "") return null;
    if (key.length > IDEMPOTENCY_KEY_MAX) throw new OpError(400, "idempotency.bad_key");
    return key;
}

export async function replayOf(db: D1Database, key: string, keyId: string): Promise<OpReply | null> {
    const row = await db.prepare("SELECT status, body FROM idempotency WHERE key = ?1 AND key_id = ?2").bind(key, keyId).first<{ status: number; body: string }>();
    if (!row) return null;
    return { status: row.status, body: JSON.parse(row.body), headers: { "idempotency-replayed": "true" } };
}

export async function remember(db: D1Database, key: string, keyId: string, reply: OpReply, now: number): Promise<void> {
    if (reply.status < 200 || reply.status > 299) return;
    await db
        .prepare("INSERT INTO idempotency (key, key_id, status, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (key, key_id) DO NOTHING")
        .bind(key, keyId, reply.status, JSON.stringify(reply.body ?? null), now)
        .run();
}
