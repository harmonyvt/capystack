// One context for every op call (HTTP, chat, MCP), as cobalt's registry/context.ts: what every call shares is built once
// per request (`opBase`), the caller-specific part on top (`forCall`).
import type { ApnsSender } from "../apns";
import type { Env } from "../env";
import type { JobsPort } from "../jobs";
import type { Caller, KeyCache } from "../keys";
import type { ModelClient } from "../model";
import type { OpContext, Via } from "./op";
import type { Registry } from "./registry";

// What the Worker entry (or a test) hands in: the clock, waitUntil, and the outside world.
export type AppDeps = {
    now: () => number;
    waitUntil?: (p: Promise<unknown>) => void;
    keyCache?: KeyCache;
    model: () => ModelClient | null;
    jobs: JobsPort | null;
    apns: ApnsSender | null;
};

export type OpBase = Pick<OpContext, "env" | "db" | "now" | "waitUntil" | "registry" | "keyCache" | "model" | "jobs" | "apns">;

export function opBase(env: Env, registry: Registry, deps: AppDeps): OpBase {
    let model: ReturnType<AppDeps["model"]> | undefined;
    return {
        env,
        db: env.DB,
        now: deps.now,
        waitUntil: deps.waitUntil,
        registry,
        keyCache: deps.keyCache,
        // built at most once per call
        model: () => (model === undefined ? (model = deps.model()) : model),
        jobs: deps.jobs,
        apns: deps.apns,
    };
}

export function forCall(
    base: OpBase,
    who: { caller: Caller | null; via: Via; request?: Request; url?: URL; params?: Record<string, string>; query?: URLSearchParams },
): OpContext {
    return {
        ...base,
        caller: who.caller,
        via: who.via,
        request: who.request,
        url: who.url,
        params: who.params ?? {},
        query: who.query ?? who.url?.searchParams ?? new URLSearchParams(),
    };
}
