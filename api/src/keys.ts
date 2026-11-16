// Bearer tokens (docs/CONTRACT.md section 3), as cobalt's api/src/keys.ts: the token check every keyed route makes, its
// per-isolate cache, and the helpers that mint and hash tokens. A token is 32 random bytes, base64url (43 characters);
// D1 only ever holds its SHA-256 as lowercase hex. No Cloudflare imports, so the tests run it against real SQLite.
//
// The web Worker mints sessions and keys too (web/src/...): it must hash and format exactly like this file.

export type KeyKind = "session" | "key";
export type Caller = { id: string; kind: KeyKind };

// A session lives this long after its last use; the slide is written at most once a day (SLIDE_EVERY_MS), so a busy
// device costs one write a day, not one per request.
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const SLIDE_EVERY_MS = 24 * 60 * 60 * 1000;

export const TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(text: string): Promise<string> {
    return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export const hashToken = sha256Hex;

export function base64url(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// A fresh bearer token: 32 random bytes, base64url without padding.
export function mintToken(): string {
    return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

// "Bearer <token>" -> the token, or null (missing, another scheme, or not a token's shape).
export function bearerOf(header: string | null): string | null {
    if (!header) return null;
    const m = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(header.trim());
    if (!m || !TOKEN_REGEX.test(m[1]!)) return null;
    return m[1]!;
}

// ---- the per-isolate cache ----------------------------------------------------------------------------------------
// A token that passed the check in the last minute is answered from memory with no D1 call. The trade-off (cobalt's,
// accepted for speed): a revoked token keeps working in an isolate that cached it for at most KEY_CACHE_TTL_MS. The
// account routes (registry/http.ts) always ask D1 and empty this isolate's cache after a write, so a revoked token can
// never use that minute to mint a spare, and the isolate that revoked it refuses it at once.
export const KEY_CACHE_TTL_MS = 60_000;
export const KEY_CACHE_MAX = 500;

export class KeyCache {
    private readonly entries = new Map<string, { caller: Caller; until: number }>();

    constructor(
        readonly ttlMs = KEY_CACHE_TTL_MS,
        readonly max = KEY_CACHE_MAX,
    ) {}

    get size(): number {
        return this.entries.size;
    }

    get(hash: string, now: number): Caller | null {
        const hit = this.entries.get(hash);
        if (!hit) return null;
        if (now < hit.until) return hit.caller;
        this.entries.delete(hash);
        return null;
    }

    set(hash: string, caller: Caller, now: number, expiresAt: number | null): void {
        const until = Math.min(now + this.ttlMs, expiresAt ?? Infinity);
        this.entries.delete(hash);
        if (!(until > now)) return;
        while (this.entries.size >= this.max) {
            const oldest = this.entries.keys().next();
            if (oldest.done) break;
            this.entries.delete(oldest.value);
        }
        this.entries.set(hash, { caller, until });
    }

    drop(hash: string): void {
        this.entries.delete(hash);
    }

    clear(): void {
        this.entries.clear();
    }
}

type KeyRow = { id: string; kind: KeyKind; expires_at: number | null; last_used_at: number | null };

// The caller behind a token, or null (unknown, revoked or expired: all three are 401 auth.required). Throws when D1
// is unreachable (the registry answers 503 then: never run an op D1 cannot vouch for). `fresh` skips the cache.
export async function lookupToken(db: D1Database, token: string, now: number, cache?: KeyCache, fresh = false): Promise<Caller | null> {
    const hash = await hashToken(token);
    const cached = fresh ? null : (cache?.get(hash, now) ?? null);
    if (cached) return cached;
    const row = await db
        .prepare(
            `SELECT id, kind, expires_at, last_used_at FROM api_keys
              WHERE token_hash = ?1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?2)`,
        )
        .bind(hash, now)
        .first<KeyRow>();
    if (!row) {
        cache?.drop(hash);
        return null;
    }
    let expiresAt = row.expires_at;
    // The slide (and last_used_at) at most once a day.
    if (row.last_used_at === null || now - row.last_used_at >= SLIDE_EVERY_MS) {
        expiresAt = row.kind === "session" ? now + SESSION_TTL_MS : row.expires_at;
        await db
            .prepare("UPDATE api_keys SET last_used_at = ?1, expires_at = CASE WHEN kind = 'session' THEN ?2 ELSE expires_at END WHERE id = ?3")
            .bind(now, now + SESSION_TTL_MS, row.id)
            .run();
    }
    const caller: Caller = { id: row.id, kind: row.kind };
    cache?.set(hash, caller, now, expiresAt);
    return caller;
}
