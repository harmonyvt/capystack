// Device sessions (docs/CONTRACT.md section 3): an api_keys row with kind = 'session', minted by POST /auth/exchange
// here and by the web Worker's POST /api/auth/web. The web Worker cannot import this package, so it duplicates the SQL
// below character for character (as cobalt's web/src/sessions.ts does); keep the two in step.
import { hashToken, mintToken, SESSION_TTL_MS } from "./keys";

// At most this many active sessions: minting one more revokes the least recently used.
export const MAX_SESSIONS = 50;
export const MAX_NAME_LENGTH = 40;
export const PLATFORMS = ["ios", "ipados", "mac", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];

// An active session (?1 = now).
export const ACTIVE_SESSION_SQL = "kind = 'session' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?1)";

// ?1 id, ?2 device (also the row's name), ?3 token_hash, ?4 platform, ?5 now (created and last used), ?6 expires_at
export const SESSION_INSERT_SQL =
    "INSERT INTO api_keys (id, kind, name, token_hash, device, platform, created_at, last_used_at, expires_at) " +
    "VALUES (?1, 'session', ?2, ?3, ?2, ?4, ?5, ?5, ?6)";

// ?1 now, ?2 MAX_SESSIONS: revokes every active session past the MAX_SESSIONS most recently used.
export const SESSION_CAP_SQL =
    "UPDATE api_keys SET revoked_at = ?1 WHERE id IN (SELECT id FROM api_keys WHERE " +
    ACTIVE_SESSION_SQL +
    " ORDER BY last_used_at DESC, created_at DESC, id DESC LIMIT -1 OFFSET ?2)";

export const SESSION_COLUMNS = "id, kind, name, device, platform, created_at, last_used_at, expires_at";

export type SessionRow = {
    id: string;
    kind: string;
    name: string;
    device: string | null;
    platform: string | null;
    created_at: number;
    last_used_at: number | null;
    expires_at: number | null;
};

// The `session` object of /auth/me, /auth/sessions and /auth/exchange.
export type Session = {
    id: string;
    kind: "session" | "key";
    name: string;
    device: string | null;
    platform: string | null;
    created_at: number;
    last_used_at: number | null;
    expires_at: number | null;
};

export const sessionBody = (r: SessionRow): Session => ({
    id: r.id,
    kind: r.kind === "key" ? "key" : "session",
    name: r.name,
    device: r.device,
    platform: r.platform,
    created_at: r.created_at,
    last_used_at: r.last_used_at,
    expires_at: r.expires_at,
});

// A device or key name: 1..40 printable characters after trimming, else null.
export function cleanName(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const s = raw.trim();
    const n = Array.from(s).length;
    if (n < 1 || n > MAX_NAME_LENGTH) return null;
    if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(s)) return null;
    return s;
}

export const isPlatform = (p: unknown): p is Platform => typeof p === "string" && (PLATFORMS as readonly string[]).includes(p);

// A new session. The plaintext token goes back to the caller once and is never stored. Then the cap.
export async function mintSession(db: D1Database, s: { device: string; platform: Platform }, now: number): Promise<{ token: string; session: Session }> {
    const id = crypto.randomUUID();
    const token = mintToken();
    const expiresAt = now + SESSION_TTL_MS;
    await db.prepare(SESSION_INSERT_SQL).bind(id, s.device, await hashToken(token), s.platform, now, expiresAt).run();
    await db.prepare(SESSION_CAP_SQL).bind(now, MAX_SESSIONS).run();
    return {
        token,
        session: { id, kind: "session", name: s.device, device: s.device, platform: s.platform, created_at: now, last_used_at: now, expires_at: expiresAt },
    };
}
