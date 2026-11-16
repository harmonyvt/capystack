// The demo job (docs/CONTRACT.md section 8): POST /jobs/demo starts a runner; every alarm step writes progress to D1
// and pushes the Live Activity: push-to-start on one device (the iPhone before the iPad), then updates to the tokens the
// activity registered, then the end.
import { describe, expect, it } from "vitest";
import { STEP_MS } from "../src/jobs";
import { world, type World } from "./world";

async function ring(w: World, jobId: string) {
    const slot = w.engines.get(jobId)!;
    w.clock.now = Math.max(w.clock.now, slot.alarm!);
    slot.alarm = null;
    return slot.engine.step();
}

describe("jobs.demo", () => {
    it("steps from alarms to done, pushing start, updates and the end", async () => {
        const w = world();
        const phone = await w.session("phone", "ios");
        const ipad = await w.session("ipad", "ipados");
        // the iPad registered last, but the phone gets the island
        await w.json("POST", "/push/tokens", { token: phone.token, body: { kind: "live_start", token: "a1".repeat(32), platform: "ios", env: "sandbox" } });
        w.clock.now += 1000;
        await w.json("POST", "/push/tokens", { token: ipad.token, body: { kind: "live_start", token: "b2".repeat(32), platform: "ipados", env: "sandbox" } });

        const started = await w.json("POST", "/jobs/demo", { token: phone.token, body: { seconds: 6 } });
        expect(started.status).toBe(202);
        const id = started.body.job.id;
        expect(started.body.job).toMatchObject({ kind: "demo", state: "running", progress: 0, title: "demo job" });
        // the request only stored the job and rang at once
        expect(w.apns.sent).toHaveLength(0);
        expect(w.engines.get(id)!.alarm).toBe(w.clock.now);

        expect(await ring(w, id)).toBe("again");
        expect(w.apns.sent).toHaveLength(1);
        expect(w.apns.sent[0]).toMatchObject({ token: "a1".repeat(32), type: "liveactivity", payload: { aps: { event: "start", attributes: { jobId: id, kind: "demo" } } } });
        expect(w.engines.get(id)!.alarm).toBe(w.clock.now + STEP_MS);

        // the app registers the started activity's update token under the job id
        expect((await w.json("POST", "/push/tokens", { token: phone.token, body: { kind: "live_update", token: "c3".repeat(32), platform: "ios", env: "sandbox", activity_id: id } })).status).toBe(201);

        expect(await ring(w, id)).toBe("again");
        const update = w.apns.sent.at(-1)!;
        expect(update).toMatchObject({ token: "c3".repeat(32), priority: 5, payload: { aps: { event: "update" } } });
        expect((update.payload as any).aps["content-state"].progress).toBeCloseTo(2 / 6, 2);
        expect((await w.json("GET", `/jobs/${id}`, { token: phone.token })).body.job.progress).toBeCloseTo(2 / 6, 2);

        let last = "again";
        for (let i = 0; i < 5 && last === "again"; i++) last = await ring(w, id);
        expect(last).toBe("done");
        expect(w.apns.sent.at(-1)).toMatchObject({ priority: 10, payload: { aps: { event: "end", "content-state": { state: "done", progress: 1 } } } });
        expect((await w.json("GET", `/jobs/${id}`, { token: phone.token })).body.job).toMatchObject({ state: "done", progress: 1 });
        // nothing more after the end
        expect(await w.engines.get(id)!.engine.step()).toBe("done");
    });

    it("runs without push, checks seconds, and 404s an unknown job", async () => {
        const w = world({ apns: false });
        const { token } = await w.session();
        expect((await w.json("POST", "/jobs/demo", { token, body: { seconds: 2 } })).status).toBe(400);
        const id = (await w.json("POST", "/jobs/demo", { token, body: {} })).body.job.id;
        expect(await ring(w, id)).toBe("again");
        expect(w.apns.sent).toHaveLength(0);
        expect((await w.json("GET", "/jobs/6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b", { token })).status).toBe(404);
    });

    it("needs activity_id for an update token", async () => {
        const w = world();
        const { token } = await w.session();
        expect((await w.json("POST", "/push/tokens", { token, body: { kind: "live_update", token: "c3".repeat(32), platform: "ios", env: "sandbox" } })).status).toBe(400);
    });

    it("upserts one token per key and kind, and moves a token between keys", async () => {
        const w = world();
        const a = await w.session("a");
        const b = await w.session("b");
        const t1 = await w.json("POST", "/push/tokens", { token: a.token, body: { kind: "device", token: "d4".repeat(32), platform: "ios", env: "sandbox" } });
        const t2 = await w.json("POST", "/push/tokens", { token: a.token, body: { kind: "device", token: "e5".repeat(32), platform: "ios", env: "sandbox" } });
        expect(t2.status).toBe(200);
        expect(t2.body.token.id).toBe(t1.body.token.id);
        await w.json("POST", "/push/tokens", { token: b.token, body: { kind: "device", token: "e5".repeat(32), platform: "ios", env: "sandbox" } });
        expect(Number((w.db.raw.prepare("SELECT COUNT(*) AS n FROM push_tokens").get() as { n: number }).n)).toBe(1);
        expect((await w.json("DELETE", `/push/tokens/${t1.body.token.id}`, { token: a.token })).status).toBe(404);
    });
});
