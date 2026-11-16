// The API Worker's entry (docs/CONTRACT.md section 2): the fetch handler (every route is an op, src/registry/), the
// 15-minute cron (src/cron.ts), and the two Durable Object classes. The only file of the Worker besides the DO classes
// that touches the runtime: everything it calls is plain TypeScript the tests run under node.
import { ApnsClient, apnsConfigFrom, type ApnsSender } from "./apns";
import { runCron } from "./cron";
import type { Env } from "./env";
import { jobsPortFrom } from "./jobs";
import { KeyCache } from "./keys";
import { modelFrom } from "./model";
import { handleRequest, REGISTRY } from "./registry";

export { ModelRelay } from "./model-relay";
export { JobRunner } from "./job-runner";

// One per isolate: the token cache (60 s) and the APNs client (its provider token is reused for 50 minutes).
const keyCache = new KeyCache();
let apns: { key: string; client: ApnsSender } | null = null;

function apnsFor(env: Env): ApnsSender | null {
    const cfg = apnsConfigFrom(env);
    if (!cfg) return null;
    const key = `${cfg.keyId}:${cfg.teamId}:${cfg.bundleId}:${cfg.forceEnv}`;
    if (apns?.key !== key) apns = { key, client: new ApnsClient(cfg, { fetch: (u, i) => fetch(u, i), now: () => Date.now() }) };
    return apns.client;
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        return handleRequest(REGISTRY, env, request, {
            now: () => Date.now(),
            waitUntil: (p) => ctx.waitUntil(p),
            keyCache,
            model: () => modelFrom(env),
            jobs: env.JOB_RUNNER ? jobsPortFrom(env.JOB_RUNNER) : null,
            apns: apnsFor(env),
        });
    },

    async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
        await runCron(env, () => Date.now(), (p) => ctx.waitUntil(p));
    },
} satisfies ExportedHandler<Env>;
