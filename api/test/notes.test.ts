// Notes (docs/CONTRACT.md section 4): CRUD, offline ids, Idempotency-Key, x-change-seq, the "pull now" push to the
// owner's other devices, and the summary.
import { describe, expect, it } from "vitest";
import { FakeModel, world } from "./world";

const ID = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

describe("notes", () => {
    it("creates, reads, updates, lists and deletes", async () => {
        const w = world();
        const { token } = await w.session();
        const made = await w.json("POST", "/notes", { token, body: { title: "groceries", body: "eggs\nmilk" } });
        expect(made.status).toBe(201);
        const id = made.body.note.id;
        expect(made.body.note).toMatchObject({ title: "groceries", body: "eggs\nmilk", created_at: w.clock.now, updated_at: w.clock.now });
        expect((await w.json("GET", `/notes/${id}`, { token })).body.note.title).toBe("groceries");

        w.clock.now += 1000;
        const up = await w.json("PATCH", `/notes/${id}`, { token, body: { body: "eggs" } });
        expect(up.body.note).toMatchObject({ title: "groceries", body: "eggs", updated_at: w.clock.now });

        const list = await w.json("GET", "/notes", { token });
        expect(list.body).toMatchObject({ notes: [{ id }], next: null });

        expect((await w.json("DELETE", `/notes/${id}`, { token })).status).toBe(200);
        expect(await w.json("GET", `/notes/${id}`, { token })).toMatchObject({ status: 404, body: { error: "notes.not_found" } });
        expect((await w.json("DELETE", `/notes/${id}`, { token })).status).toBe(404);
    });

    it("takes the client's own id, and refuses it twice", async () => {
        const w = world();
        const { token } = await w.session();
        expect((await w.json("POST", "/notes", { token, body: { id: ID, title: "offline" } })).body.note.id).toBe(ID);
        expect(await w.json("POST", "/notes", { token, body: { id: ID, title: "again" } })).toMatchObject({ status: 409, body: { error: "notes.exists" } });
        expect((await w.json("POST", "/notes", { token, body: { id: "NOT-A-UUID" } })).status).toBe(400);
    });

    it("replays a retried write with the same Idempotency-Key instead of running it again", async () => {
        const w = world();
        const { token } = await w.session();
        const headers = { "idempotency-key": "outbox-1" };
        const first = await w.json("POST", "/notes", { token, headers, body: { title: "once" } });
        const second = await w.json("POST", "/notes", { token, headers, body: { title: "once" } });
        expect(second.status).toBe(201);
        expect(second.body).toEqual(first.body);
        expect(second.headers.get("idempotency-replayed")).toBe("true");
        expect(Number((w.db.raw.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n)).toBe(1);
        // another credential with the same key is another key
        const other = await w.session("mac", "mac");
        expect((await w.json("POST", "/notes", { token: other.token, headers, body: { title: "once" } })).body.note.id).not.toBe(first.body.note.id);
    });

    it("stamps writes with the change number", async () => {
        const w = world();
        const { token } = await w.session();
        const a = await w.json("POST", "/notes", { token, body: { title: "a" } });
        const b = await w.json("POST", "/notes", { token, body: { title: "b" } });
        expect(Number(a.headers.get("x-change-seq"))).toBeGreaterThan(0);
        expect(Number(b.headers.get("x-change-seq"))).toBe(Number(a.headers.get("x-change-seq")) + 1);
        expect((await w.json("GET", "/notes", { token })).headers.get("x-change-seq")).toBeNull();
    });

    it("pages the list newest change first", async () => {
        const w = world();
        const { token } = await w.session();
        for (let i = 0; i < 5; i++) {
            w.clock.now += 1000;
            await w.json("POST", "/notes", { token, body: { title: `n${i}` } });
        }
        const p1 = await w.json("GET", "/notes?limit=2", { token });
        expect(p1.body.notes.map((n: any) => n.title)).toEqual(["n4", "n3"]);
        const p2 = await w.json("GET", `/notes?limit=2&before=${p1.body.next}`, { token });
        expect(p2.body.notes.map((n: any) => n.title)).toEqual(["n2", "n1"]);
        const p3 = await w.json("GET", `/notes?limit=2&before=${p2.body.next}`, { token });
        expect(p3.body).toMatchObject({ notes: [{ title: "n0" }], next: null });
        expect((await w.json("GET", "/notes?limit=500", { token })).status).toBe(400);
    });

    it("sends a silent pull hint to the owner's other devices, not the writer's", async () => {
        const w = world({ env: {} });
        const phone = await w.session("phone");
        const mac = await w.session("mac", "mac");
        for (const [s, tok] of [
            [phone, "aa".repeat(32)],
            [mac, "bb".repeat(32)],
        ] as const) {
            expect((await w.json("POST", "/push/tokens", { token: s.token, body: { kind: "device", token: tok, platform: "ios", env: "sandbox" } })).status).toBe(201);
        }
        await w.json("POST", "/notes", { token: phone.token, body: { title: "x" } });
        expect(w.apns.sent).toHaveLength(1);
        expect(w.apns.sent[0]).toMatchObject({ token: "bb".repeat(32), type: "background", priority: 5, payload: { aps: { "content-available": 1 } } });
    });

    it("forgets a token Apple calls dead", async () => {
        const w = world();
        const phone = await w.session("phone");
        const mac = await w.session("mac", "mac");
        await w.json("POST", "/push/tokens", { token: mac.token, body: { kind: "device", token: "cc".repeat(32), platform: "mac", env: "production" } });
        w.apns.answer = () => ({ kind: "drop", status: 410, reason: "Unregistered" });
        await w.json("POST", "/notes", { token: phone.token, body: { title: "x" } });
        expect(Number((w.db.raw.prepare("SELECT COUNT(*) AS n FROM push_tokens").get() as { n: number }).n)).toBe(0);
    });
});

describe("notes.summarize", () => {
    it("answers 503 ai.off without a model", async () => {
        const w = world();
        const { token } = await w.session();
        const id = (await w.json("POST", "/notes", { token, body: { title: "t", body: "b" } })).body.note.id;
        expect(await w.json("POST", `/notes/${id}/summarize`, { token })).toMatchObject({ status: 503, body: { error: "ai.off" } });
    });

    it("asks the model with the note and returns its words", async () => {
        const model = new FakeModel([() => ({ content: [{ type: "text", text: "a list of eggs.", citations: null }] as never })]);
        const w = world({ model, env: { CHAT_MODEL: "claude-haiku-5-5" } });
        const { token } = await w.session();
        const id = (await w.json("POST", "/notes", { token, body: { title: "groceries", body: "eggs" } })).body.note.id;
        expect(await w.json("POST", `/notes/${id}/summarize`, { token })).toMatchObject({ status: 200, body: { summary: "a list of eggs." } });
        expect(model.calls[0]).toMatchObject({ model: "claude-haiku-5-5", messages: [{ role: "user", content: "title: groceries\n\neggs" }] });
    });
});
