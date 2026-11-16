// The demo job (docs/CONTRACT.md section 8): POST /jobs/demo starts a JobRunner Durable Object that counts to 100% over
// `seconds`, writing progress to D1 and pushing a Live Activity (start on one device, then updates). GET /jobs/:id
// reads it back for clients without the island (web, Mac).
import * as z from "zod";
import { DEFAULT_SECONDS, JOB_COLUMNS, jobBody, MAX_SECONDS, MIN_SECONDS, type Job } from "../../jobs";
import { defineOp, ok, OpError } from "../op";
import { JobShape, Uuid } from "../shapes";

export const jobsDemoOp = defineOp({
    name: "jobs.demo",
    doc: "Start the demo job (a Live Activity on the phone).",
    route: { method: "POST", path: "/jobs/demo" },
    auth: "key",
    input: z.object({ seconds: z.number().int().min(MIN_SECONDS).max(MAX_SECONDS).optional() }),
    output: z.object({ job: JobShape }),
    handler: async (ctx, input) => {
        if (!ctx.jobs) throw new OpError(503, "jobs.off", "the JobRunner binding is missing");
        const now = ctx.now();
        const job: Job = { id: crypto.randomUUID(), kind: "demo", state: "running", progress: 0, title: "demo job", created_at: now, updated_at: now };
        await ctx.db
            .prepare("INSERT INTO jobs (id, kind, state, progress, title, key_id, created_at, updated_at) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?6)")
            .bind(job.id, job.kind, job.state, job.title, ctx.caller!.id, now)
            .run();
        try {
            await ctx.jobs.start(job, input.seconds ?? DEFAULT_SECONDS);
        } catch (e) {
            await ctx.db.prepare("UPDATE jobs SET state = 'failed', updated_at = ?2 WHERE id = ?1").bind(job.id, ctx.now()).run();
            throw e;
        }
        return ok({ job }, 202);
    },
});

export const jobsGetOp = defineOp({
    name: "jobs.get",
    doc: "A job's state and progress.",
    route: { method: "GET", path: "/jobs/:id" },
    auth: "key",
    input: z.object({ id: Uuid }),
    output: z.object({ job: JobShape }),
    handler: async (ctx, input) => {
        const row = await ctx.db.prepare(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?1`).bind(input.id).first<Job>();
        if (!row) throw new OpError(404, "jobs.not_found");
        return ok({ job: jobBody(row) });
    },
});

export const JOB_OPS = [jobsDemoOp, jobsGetOp];
