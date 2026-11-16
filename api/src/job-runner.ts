// The JobRunner Durable Object (docs/CONTRACT.md section 8): one object per job (idFromName(job id)), stepping
// JobEngine from alarm() every 2 seconds. Imported only by the Worker entry (index.ts): `cloudflare:workers` does not
// exist under node, so the tests drive JobEngine directly.
import { DurableObject } from "cloudflare:workers";
import { ApnsClient, apnsConfigFrom } from "./apns";
import type { Env } from "./env";
import { JobEngine, type Job } from "./jobs";

export class JobRunner extends DurableObject<Env> {
    private engine(): JobEngine {
        const cfg = apnsConfigFrom(this.env);
        return new JobEngine({
            db: this.env.DB,
            storage: this.ctx.storage,
            now: () => Date.now(),
            apns: cfg ? new ApnsClient(cfg, { fetch: (u, i) => fetch(u, i), now: () => Date.now() }) : null,
            setAlarm: (at) => this.ctx.storage.setAlarm(at),
        });
    }

    // POST {job, seconds} from the Worker (jobs.demo). Only stores and rings: see src/jobs.ts.
    async fetch(request: Request): Promise<Response> {
        if (request.method !== "POST") return new Response(null, { status: 405 });
        const { job, seconds } = (await request.json()) as { job: Job; seconds: number };
        await this.engine().start(job, seconds);
        return new Response(null, { status: 204 });
    }

    async alarm(): Promise<void> {
        await this.engine().step();
    }
}

