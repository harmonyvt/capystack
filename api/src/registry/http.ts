// The registry's HTTP side (docs/CONTRACT.md section 4), as cobalt's registry/http.ts plus its gate: CORS for the web
// origin and its preflights, the bearer check, the input check, Idempotency-Key, x-change-seq, one PostHog `op` event
// per call, and the 404 for anything no op takes. No Cloudflare imports: the tests call it with a fake D1.
import type { Env } from "../env";
import { bearerOf, lookupToken, type Caller } from "../keys";
import { capture, logEvent, opEvents } from "../posthog";
import { changeSeq, CHANGE_SEQ_HEADER, idempotencyKeyOf, remember, replayOf } from "../sync";
import { forCall, opBase, type AppDeps } from "./context";
import { OpError, type Op, type OpContext, type OpReply } from "./op";
import type { Registry } from "./registry";
import { zodMessage } from "./zod";

export const DEFAULT_CORS_URL = "https://capystack.capybaraharmony.com";
const ALLOW_HEADERS = "authorization, content-type, idempotency-key, x-capy-client";
const ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

const corsOrigin = (env: Env) => (env.CORS_URL ?? "").trim().replace(/\/+$/, "") || DEFAULT_CORS_URL;

// The account routes hand out or take away credentials: they always ask D1 (never the isolate's cache), and a write
// through them empties this isolate's cache, so a revoked token is refused on its very next request here.
const ACCOUNT_PATH = "/auth/";
const isAccount = (op: Op) => op.route.path.startsWith(ACCOUNT_PATH);
const isWrite = (method: string) => method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";

export const errorBody = (code: string, message?: string) => (message && message !== code ? { error: code, message } : { error: code });

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}

// Every answer to the web origin carries its CORS headers (errors too, so the page can read a 401).
function withCors(res: Response, allow: string | null): Response {
    if (!allow) return res;
    const out = new Response(res.body, res);
    out.headers.set("access-control-allow-origin", allow);
    out.headers.set("access-control-expose-headers", `${CHANGE_SEQ_HEADER}, idempotency-replayed`);
    out.headers.append("vary", "origin");
    return out;
}

export async function handleRequest(registry: Registry, env: Env, request: Request, deps: AppDeps): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const allow = origin !== null && origin === corsOrigin(env) ? origin : null;

    if (request.method === "OPTIONS") {
        if (!registry.knowsPath(url.pathname)) return json(404, errorBody("not_found"));
        if (!allow) return json(403, errorBody("cors.origin"));
        return new Response(null, {
            status: 204,
            headers: {
                "access-control-allow-origin": allow,
                "access-control-allow-methods": ALLOW_METHODS,
                "access-control-allow-headers": ALLOW_HEADERS,
                "access-control-max-age": "86400",
                vary: "origin",
            },
        });
    }

    const m = registry.match(request.method, url.pathname);
    if (!m) return withCors(json(404, errorBody("not_found")), allow);

    const started = deps.now();
    const base = opBase(env, registry, deps);
    const seen: { caller: Caller | null } = { caller: null };
    const res = await answer(m.op, m.params);
    const ms = deps.now() - started;
    // one event per call, after the answer, never changing it
    let error: string | null = null;
    if (res.status >= 400 && (res.headers.get("content-type") ?? "").includes("json")) {
        error = await res
            .clone()
            .json()
            .then((b) => ((b as { error?: unknown })?.error && typeof (b as { error?: unknown }).error === "string" ? ((b as { error: string }).error as string) : null))
            .catch(() => null);
    }
    void capture(env, deps.waitUntil, opEvents({ op: m.op.name, status: res.status, ms, via: "http", keyId: seen.caller?.id ?? null, error }, deps.now()));
    return withCors(res, allow);

    async function answer(op: Op, params: Record<string, string>): Promise<Response> {
        // ---- who is asking ----
        let caller: Caller | null = null;
        if (op.auth !== "open") {
            const token = bearerOf(request.headers.get("authorization"));
            if (!token) return json(401, errorBody("auth.required"));
            try {
                caller = await lookupToken(base.db, token, deps.now(), deps.keyCache, isAccount(op));
            } catch (e) {
                // fail closed: never run an op D1 cannot vouch for
                console.error("[auth] lookup failed", e instanceof Error ? e.message : String(e));
                void capture(env, deps.waitUntil, [logEvent("error", "auth lookup failed", deps.now(), { op: op.name })]);
                return json(503, errorBody("unavailable"));
            }
            if (!caller) return json(401, errorBody("auth.required"));
            seen.caller = caller;
            if (op.auth === "session" && caller.kind !== "session") return json(403, errorBody("auth.session_required"));
        }
        const ctx = forCall(base, { caller, via: "http", request, url, params });
        const write = isWrite(request.method) && !op.raw && caller !== null;
        try {
            let key: string | null = null;
            if (write) {
                key = idempotencyKeyOf(request);
                const replay = key ? await replayOf(base.db, key, caller!.id) : null;
                if (replay) return reply(replay);
            }
            const input = await httpInput(op, ctx);
            const out = await op.handler(ctx, input);
            if (out instanceof Response) return out;
            if (!write) return reply(out);
            const seq = await changeSeq(base.db).catch(() => null);
            const stamped: OpReply = seq === null ? out : { ...out, headers: { ...out.headers, [CHANGE_SEQ_HEADER]: String(seq) } };
            if (key) await remember(base.db, key, caller!.id, stamped, deps.now()).catch((e) => console.error("[idempotency] store failed", String(e)));
            return reply(stamped);
        } catch (e) {
            if (e instanceof OpError) return json(e.status, errorBody(e.code, e.message));
            console.error(`[ops] ${op.name} failed`, e instanceof Error ? e.message : String(e));
            // the error's name only: a message may carry user text
            void capture(env, deps.waitUntil, [logEvent("error", "op threw", deps.now(), { op: op.name, kind: e instanceof Error ? e.name : "unknown" })]);
            return json(500, errorBody("internal"));
        } finally {
            // whatever the handler answered: a refusal may still have followed a statement that revoked
            if (isAccount(op) && isWrite(request.method)) deps.keyCache?.clear();
        }
    }
}

const reply = (r: OpReply) => json(r.status, r.body, r.headers);

// The input: the op's own reader, or query + path params + the JSON body (POST/PUT/PATCH), checked against the schema.
async function httpInput(op: Op, ctx: OpContext): Promise<unknown> {
    let raw: unknown;
    if (op.http) raw = await op.http(ctx);
    else {
        const obj: Record<string, unknown> = { ...Object.fromEntries(ctx.query) };
        const method = ctx.request!.method;
        if (method === "POST" || method === "PUT" || method === "PATCH") {
            const text = await ctx.request!.text();
            if (text.trim() !== "") {
                let body: unknown;
                try {
                    body = JSON.parse(text);
                } catch {
                    throw new OpError(400, "bad_request", "the body is not JSON");
                }
                if (!body || typeof body !== "object" || Array.isArray(body)) throw new OpError(400, "bad_request", "the body must be a JSON object");
                Object.assign(obj, body);
            }
        }
        // path params always win over the query and the body
        Object.assign(obj, ctx.params);
        raw = obj;
    }
    const r = op.input.safeParse(raw);
    if (!r.success) throw new OpError(400, op.badRequest ?? "bad_request", op.badRequest ? undefined : zodMessage(op.name, r.error));
    return r.data;
}
