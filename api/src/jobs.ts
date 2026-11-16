// The demo job and its Live Activity (docs/CONTRACT.md section 8). The JobRunner Durable Object (src/job-runner.ts) is
// a thin shell around JobEngine here, which is pure (storage, clock, APNs and the alarm are injected) so the tests step
// it with fakes.
//
// Runtime lesson from cobalt: work after a Durable Object's response does not survive. So the start request only stores
// the job and sets an alarm; every step (progress in D1, the push-to-start, each update, the end) runs from alarm(),
// which the runtime retries if it throws.
import { liveEndPayload, liveStartPayload, liveUpdatePayload, type ApnsSender } from "./apns";
import { forgetIfDead, liveStartTarget, liveUpdateTargets } from "./push";

export const STEP_MS = 2000;
export const MIN_SECONDS = 5;
export const MAX_SECONDS = 120;
export const DEFAULT_SECONDS = 20;

export type JobState = "running" | "done" | "failed";
export type Job = { id: string; kind: "demo"; state: JobState; progress: number; title: string; created_at: number; updated_at: number };
export type JobRow = Job & { key_id: string | null };

export const JOB_COLUMNS = "id, kind, state, progress, title, created_at, updated_at";

// What starts a runner. The Worker's is a DO stub call; tests pass the engine itself.
export type JobsPort = { start(job: Job, seconds: number): Promise<void> };

// The bit of Durable Object storage the engine uses.
export type KV = {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean | void>;
};

export type JobRecord = { job: Job; seconds: number; startedAt: number; startSent: boolean };

export type EngineDeps = {
    db: D1Database;
    storage: KV;
    now: () => number;
    apns: ApnsSender | null;
    setAlarm: (at: number) => Promise<void>;
};

const RECORD = "job";

export class JobEngine {
    constructor(private readonly d: EngineDeps) {}

    // The DO's fetch: remember the job, ring at once. Nothing else happens before the answer.
    async start(job: Job, seconds: number): Promise<void> {
        const rec: JobRecord = { job, seconds: Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, seconds)), startedAt: this.d.now(), startSent: false };
        await this.d.storage.put(RECORD, rec);
        await this.d.setAlarm(this.d.now());
    }

    // One alarm: move the progress on, write it, push it, ring again in STEP_MS unless the job is over.
    async step(): Promise<"again" | "done"> {
        const rec = await this.d.storage.get<JobRecord>(RECORD);
        if (!rec || rec.job.state !== "running") return "done";
        const now = this.d.now();
        const progress = Math.min(1, (now - rec.startedAt) / (rec.seconds * 1000));
        const state: JobState = progress >= 1 ? "done" : "running";
        const job: Job = { ...rec.job, progress: Math.round(progress * 1000) / 1000, state, updated_at: now };
        await this.d.db.prepare("UPDATE jobs SET progress = ?1, state = ?2, updated_at = ?3 WHERE id = ?4").bind(job.progress, job.state, now, job.id).run();
        const next: JobRecord = { ...rec, job };
        try {
            next.startSent = await this.push(rec, job, now);
        } catch (e) {
            // a push never stops the job
            console.error("[jobs] push failed", e instanceof Error ? e.message : String(e));
        }
        await this.d.storage.put(RECORD, next);
        if (state !== "running") return "done";
        await this.d.setAlarm(now + STEP_MS);
        return "again";
    }

    // The first step push-starts the island on one device; later steps update every token the activity registered.
    // Returns whether the start went out (it is tried once: a device that did not take it updates locally).
    private async push(rec: JobRecord, job: Job, now: number): Promise<boolean> {
        const apns = this.d.apns;
        if (!apns) return rec.startSent;
        if (!rec.startSent) {
            const target = await liveStartTarget(this.d.db);
            if (target) {
                const d = await apns.send({ token: target.token, env: target.env, type: "liveactivity", priority: 10, payload: liveStartPayload(job, now) });
                await forgetIfDead(this.d.db, target.token, d);
            }
            return true;
        }
        const end = job.state !== "running";
        for (const t of await liveUpdateTargets(this.d.db, job.id)) {
            const payload = end ? liveEndPayload(job, now) : liveUpdatePayload(job, now);
            // updates at priority 5 are budgeted generously by Apple; the end is worth a 10
            const d = await apns.send({ token: t.token, env: t.env, type: "liveactivity", priority: end ? 10 : 5, payload });
            await forgetIfDead(this.d.db, t.token, d);
        }
        return true;
    }
}

export const jobBody = (r: Job): Job => ({
    id: r.id,
    kind: r.kind,
    state: r.state,
    progress: Number(r.progress),
    title: r.title,
    created_at: r.created_at,
    updated_at: r.updated_at,
});

// The Worker's side of the port: one JobRunner object per job, by name.
export const jobsPortFrom = (ns: { idFromName(n: string): unknown; get(id: any): { fetch(r: Request): Promise<Response> } }): JobsPort => ({
    async start(job: Job, seconds: number): Promise<void> {
        const res = await ns.get(ns.idFromName(job.id)).fetch(
            new Request("https://job-runner.internal/start", { method: "POST", body: JSON.stringify({ job, seconds }), headers: { "content-type": "application/json" } }),
        );
        if (!res.ok) throw new Error(`job runner answered ${res.status}`);
    },
});
