// Device sessions (contract section 3): `api_keys` rows with kind = 'session', 90-day sliding expiry, at most 50.
// The API Worker owns the lookup and the /auth/* routes; this Worker only mints (web sign-in, app handoff is the API's).
// The SQL here and in api/src must stay in step: web/test/sessions.test.ts runs it against the real migration.
import { hashToken, newToken } from "./http";

export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_SESSIONS = 50;
export const MAX_DEVICE_LENGTH = 40;
export const PLATFORMS = ["ios", "ipados", "mac", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const ACTIVE_SESSION_SQL = "kind = 'session' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?1)";

// ?1 id, ?2 device (also the row's name), ?3 token_hash, ?4 platform, ?5 now (created and last used), ?6 expires_at.
export const SESSION_INSERT_SQL =
    "INSERT INTO api_keys (id, kind, name, token_hash, device, platform, created_at, last_used_at, expires_at) " +
    "VALUES (?1, 'session', ?2, ?3, ?2, ?4, ?5, ?5, ?6)";

// ?1 now, ?2 MAX_SESSIONS: revokes every active session past the newest-used MAX_SESSIONS.
export const SESSION_CAP_SQL =
    "UPDATE api_keys SET revoked_at = ?1 WHERE id IN (SELECT id FROM api_keys WHERE " +
    ACTIVE_SESSION_SQL +
    " ORDER BY last_used_at DESC, created_at DESC, id DESC LIMIT -1 OFFSET ?2)";

// The `session` shape of contract section 4 (auth.me).
export type Session = {
    id: string;
    kind: "session";
    name: string;
    device: string;
    platform: string;
    created_at: number;
    last_used_at: number;
    expires_at: number;
};

// A device name: 1..40 printable characters after trimming (no control characters or line breaks), else null.
export function cleanDevice(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const s = raw.trim();
    const n = Array.from(s).length;
    if (n < 1 || n > MAX_DEVICE_LENGTH) return null;
    if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(s)) return null;
    return s;
}

// A new session: the plaintext token goes back to the caller once and is never stored. Then the cap.
export async function mintSession(
    db: D1Database,
    s: { device: string; platform: Platform },
    now: number,
): Promise<{ token: string; session: Session }> {
    const id = crypto.randomUUID();
    const token = newToken();
    const expiresAt = now + SESSION_TTL_MS;
    await db.prepare(SESSION_INSERT_SQL).bind(id, s.device, await hashToken(token), s.platform, now, expiresAt).run();
    await db.prepare(SESSION_CAP_SQL).bind(now, MAX_SESSIONS).run();
    return {
        token,
        session: { id, kind: "session", name: s.device, device: s.device, platform: s.platform, created_at: now, last_used_at: now, expires_at: expiresAt },
    };
}

// "safari on mac", "chrome on windows", "firefox on linux", ...; "browser" when the browser is not recognised.
export function deviceFromUserAgent(ua: string | null): string {
    const u = ua ?? "";
    let browser: string | null = null;
    if (/Firefox\/|FxiOS\//.test(u)) browser = "firefox";
    else if (/Edg(e|A|iOS)?\//.test(u)) browser = "edge";
    else if (/OPR\/|Opera/.test(u)) browser = "opera";
    else if (/Chrome\/|CriOS\/|Chromium\//.test(u)) browser = "chrome";
    else if (/Safari\//.test(u) && /Version\//.test(u)) browser = "safari";
    if (!browser) return "browser";
    let os: string | null = null;
    if (/iPhone|iPod/.test(u)) os = "iphone";
    else if (/iPad/.test(u)) os = "ipad";
    else if (/Android/.test(u)) os = "android";
    else if (/CrOS/.test(u)) os = "chromeos";
    else if (/Macintosh|Mac OS X/.test(u)) os = "mac";
    else if (/Windows/.test(u)) os = "windows";
    else if (/Linux/.test(u)) os = "linux";
    return os ? `${browser} on ${os}` : browser;
}
