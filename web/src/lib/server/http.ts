// Small response helpers shared by the server handlers. Errors are `{ error: "<dotted.code>" }` (contract section 4).
export type ErrorCode =
    | "auth.required"
    | "auth.forbidden"
    | "bad_request"
    | "not_found"
    | "method_not_allowed"
    | "keys.too_many"
    | "server_error";

export const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
    });

export const error = (status: number, code: ErrorCode, extra?: Record<string, string>) => json(status, { error: code }, extra);

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// Lowercase hex SHA-256 of a token or code. The API Worker hashes presented tokens the same way.
export async function hashToken(token: string): Promise<string> {
    return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

export const b64url = (bytes: Uint8Array) => {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

// 32 random bytes, base64url: 43 characters. Used for session tokens, key tokens and handoff codes.
export const newToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export const TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const originOf = (request: Request, env: { WEB_ORIGIN?: string }) => env.WEB_ORIGIN || new URL(request.url).origin;
