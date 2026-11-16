// PostHog events from the Worker (docs/CONTRACT.md section 9), ported from cobalt's api/src/posthog.ts: one `op` event
// per route, chat or MCP call, warn/error lines, and cron runs, sent to PostHog's batch API with a plain fetch (no
// PostHog package). Off unless POSTHOG_TOKEN is set. Free of Cloudflare imports.
//
// Rules:
//  - Never changes an answer: sent through background() (ctx.waitUntil) with its own timeout; a failure is a console line.
//  - Never sends tokens, request bodies or note text: an op event is the op's name, status, time and `via`.
//  - distinct_id is the caller's key id ("anonymous" on open routes), so a device's events sit together.
import { background, withTimeout } from "./background";

export const DEFAULT_HOST = "https://us.i.posthog.com";
export const SEND_TIMEOUT_MS = 3000;
const MAX_PROP_CHARS = 300;

export type PostHogEnv = { POSTHOG_TOKEN?: string; POSTHOG_HOST?: string };
export type PostHogEvent = { event: string; distinct_id: string; timestamp: string; properties: Record<string, unknown> };
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export type PostHogConfig = { token: string; host: string };

export function postHogConfig(env: PostHogEnv): PostHogConfig | null {
    const token = (env.POSTHOG_TOKEN ?? "").trim();
    if (!token) return null;
    const host = (env.POSTHOG_HOST ?? "").trim().replace(/\/+$/, "") || DEFAULT_HOST;
    return { token, host };
}

const clip = (v: unknown) => (typeof v === "string" && v.length > MAX_PROP_CHARS ? v.slice(0, MAX_PROP_CHARS) : v);

export function makeEvent(event: string, distinctId: string, ts: number, properties: Record<string, unknown>): PostHogEvent {
    const props: Record<string, unknown> = { $lib: "capystack-worker" };
    for (const [k, v] of Object.entries(properties)) if (v !== undefined && v !== null) props[k] = clip(v);
    return { event, distinct_id: distinctId, timestamp: new Date(ts).toISOString(), properties: props };
}

// POSTs one batch. Resolves either way; returns whether PostHog took it.
export async function sendBatch(cfg: PostHogConfig, events: PostHogEvent[], fetchFn: FetchLike = fetch): Promise<boolean> {
    if (events.length === 0) return true;
    try {
        const res = await withTimeout(
            fetchFn(`${cfg.host}/batch/`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ api_key: cfg.token, batch: events }),
            }),
            SEND_TIMEOUT_MS,
            "posthog send",
        );
        if (!res.ok) console.error(`[posthog] send answered ${res.status}`);
        void res.body?.cancel().catch(() => {});
        return res.ok;
    } catch (e) {
        console.error("[posthog] send failed", e instanceof Error ? e.message : "error");
        return false;
    }
}

// Fire-and-forget. Never rejects.
export function capture(env: PostHogEnv, waitUntil: ((p: Promise<unknown>) => void) | undefined, events: PostHogEvent[], fetchFn?: FetchLike): Promise<void> {
    const cfg = postHogConfig(env);
    if (!cfg || events.length === 0) return Promise.resolve();
    return background(waitUntil, () => sendBatch(cfg, events, fetchFn)).catch(() => {});
}

export type OpCall = { op: string; status: number; ms: number; via: "http" | "chat" | "mcp"; keyId: string | null; error?: string | null };

// One `op` event; a 5xx also becomes an `$exception` so PostHog's error tracking sees it.
export function opEvents(c: OpCall, ts: number): PostHogEvent[] {
    const id = c.keyId ?? "anonymous";
    const props = { op: c.op, status: c.status, ms: Math.round(c.ms), via: c.via, ok: c.status >= 200 && c.status < 400, error_code: c.error ?? undefined };
    const out = [makeEvent("op", id, ts, props)];
    if (c.status >= 500) {
        out.push(
            makeEvent("$exception", id, ts, {
                ...props,
                $exception_list: [{ type: "OpFailed", value: `${c.op} answered ${c.status}${c.error ? ` ${c.error}` : ""}`, mechanism: { handled: true, synthetic: true } }],
                $exception_level: "error",
                source: "worker",
            }),
        );
    }
    return out;
}

// A warn/error line from the Worker itself.
export const logEvent = (level: "warn" | "error", msg: string, ts: number, data: Record<string, unknown> = {}) =>
    makeEvent("server_log", "server", ts, { ...data, level, msg });

export const cronEvent = (job: string, ts: number, ms: number, ok: boolean, detail: Record<string, unknown> = {}) =>
    makeEvent("cron_run", "server", ts, { ...detail, job, ms: Math.round(ms), ok });
