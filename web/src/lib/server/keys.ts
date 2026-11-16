// /api/keys: the owner's "keys for tools" (MCP, scripts), served by the web Worker. Only kind = 'key' rows: device
// sessions (kind = 'session') are listed and revoked by the API's /auth/* routes.
// Authentication happens before anything else touches D1: a valid Cloudflare Access JWT for the owner's email.
// Only SHA-256 hashes are stored; the plaintext token is returned once, by POST.
import type { Env } from "./env";
import { error, hashToken, json, newToken, originOf, UUID_REGEX } from "./http";
import { authenticate, type Deps } from "./owner";

export const MAX_KEYS = 50;
export const MAX_NAME_LENGTH = 40;
const MAX_BODY_BYTES = 2048;

type KeyRow = { id: string; name: string; created_at: number; last_used_at: number | null };

export async function handleKeys(request: Request, env: Env, deps?: Partial<Deps>): Promise<Response> {
    const now = deps?.now ?? Date.now;

    // 1. Authenticate. Fails closed on any problem, including JWKS outages.
    const auth = await authenticate(request, env, deps);
    if (!auth.ok) return error(401, "auth.required");

    const { pathname } = new URL(request.url);
    const method = request.method;

    // Route shape (method allowed for the path) before the CSRF check, so a wrong-method request never reaches
    // state-changing code.
    const isCollection = pathname === "/api/keys";
    const idMatch = /^\/api\/keys\/([^/]+)$/.exec(pathname);
    if (!isCollection && !idMatch) return error(404, "not_found");
    const allowed = isCollection ? ["GET", "POST"] : ["DELETE"];
    if (!allowed.includes(method)) return error(405, "method_not_allowed", { allow: allowed.join(", ") });

    // 2. CSRF: state-changing calls must come from the web app itself.
    if (method !== "GET" && request.headers.get("Origin") !== originOf(request, env)) return error(403, "auth.forbidden");

    try {
        if (method === "GET") return await list(env);
        if (method === "POST") return await create(request, env, now());
        return await revoke(env, idMatch![1]!, now());
    } catch {
        return error(500, "server_error");
    }
}

async function list(env: Env): Promise<Response> {
    const { results } = await env.DB.prepare(
        "SELECT id, name, created_at, last_used_at FROM api_keys WHERE kind = 'key' AND revoked_at IS NULL ORDER BY created_at DESC, id DESC",
    ).all<KeyRow>();
    return json(200, { keys: results });
}

const isJson = (request: Request) => (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() === "application/json";

async function readName(request: Request): Promise<string | null> {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return null;
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    const name = (body as Record<string, unknown>).name;
    if (typeof name !== "string") return null;
    const trimmed = name.trim();
    const length = Array.from(trimmed).length;
    return length >= 1 && length <= MAX_NAME_LENGTH ? trimmed : null;
}

async function create(request: Request, env: Env, now: number): Promise<Response> {
    if (!isJson(request)) return error(415, "bad_request");
    const name = await readName(request);
    if (name === null) return error(400, "bad_request");

    const token = newToken();
    const id = crypto.randomUUID();

    // The cap is enforced inside the INSERT so concurrent creates cannot overshoot it: no row inserted means the cap
    // was already reached.
    const res = await env.DB.prepare(
        `INSERT INTO api_keys (id, kind, name, token_hash, created_at)
         SELECT ?1, 'key', ?2, ?3, ?4
         WHERE (SELECT COUNT(*) FROM api_keys WHERE kind = 'key' AND revoked_at IS NULL) < ?5
         RETURNING id`,
    )
        .bind(id, name, await hashToken(token), now, MAX_KEYS)
        .all<{ id: string }>();
    if (res.results.length === 0) return error(409, "keys.too_many");

    return json(201, { key: { id, name, created_at: now, last_used_at: null }, token });
}

async function revoke(env: Env, id: string, now: number): Promise<Response> {
    if (!UUID_REGEX.test(id)) return error(404, "not_found");
    const res = await env.DB.prepare("UPDATE api_keys SET revoked_at = ?1 WHERE id = ?2 AND kind = 'key' AND revoked_at IS NULL RETURNING id")
        .bind(now, id)
        .all<{ id: string }>();
    if (res.results.length === 0) return error(404, "not_found");
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
