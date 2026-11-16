// Sync (docs/CONTRACT.md section 5): the triggers fill `changes`, GET /sync pages through it, deletes come back as gone,
// and a client behind a trimmed delete marker gets 410 sync.too_old.
import { describe, expect, it } from "vitest";
import { cleanup } from "../src/cron";
import { GONE_KEEP_MS, syncPage } from "../src/sync";
import { world } from "./world";

describe("the change log", () => {
    it("keeps one row per note, the newest change last", async () => {
        const w = world();
        const { token } = await w.session();
        const id = (await w.json("POST", "/notes", { token, body: { title: "a" } })).body.note.id;
        await w.json("PATCH", `/notes/${id}`, { token, body: { title: "b" } });
        await w.json("PATCH", `/notes/${id}`, { token, body: { title: "c" } });
        expect(w.db.raw.prepare("SELECT entity, id, gone FROM changes").all().map((r) => ({ ...r }))).toEqual([{ entity: "note", id, gone: 0 }]);
        await w.json("DELETE", `/notes/${id}`, { token });
        expect(w.db.raw.prepare("SELECT gone FROM changes").all().map((r) => ({ ...r }))).toEqual([{ gone: 1 }]);
    });
});

describe("GET /sync", () => {
    it("pulls everything, then only what changed, with deletes as gone", async () => {
        const w = world();
        const { token } = await w.session();
        const a = (await w.json("POST", "/notes", { token, body: { title: "a" } })).body.note.id;
        const b = (await w.json("POST", "/notes", { token, body: { title: "b" } })).body.note.id;
        const first = await w.json("GET", "/sync", { token });
        expect(first.status).toBe(200);
        expect(first.body).toMatchObject({ since: 0, more: false, gone: [] });
        expect(first.body.notes.map((n: any) => n.title).sort()).toEqual(["a", "b"]);

        const quiet = await w.json("GET", `/sync?since=${first.body.next}`, { token });
        expect(quiet.body).toMatchObject({ notes: [], gone: [], more: false, next: first.body.next });

        await w.json("PATCH", `/notes/${a}`, { token, body: { title: "a2" } });
        await w.json("DELETE", `/notes/${b}`, { token });
        const delta = await w.json("GET", `/sync?since=${first.body.next}`, { token });
        expect(delta.body.notes).toMatchObject([{ id: a, title: "a2" }]);
        expect(delta.body.gone).toEqual([{ entity: "note", id: b }]);
    });

    it("pages at the limit", async () => {
        const w = world();
        const { token } = await w.session();
        for (let i = 0; i < 7; i++) await w.json("POST", "/notes", { token, body: { title: `n${i}` } });
        let since = 0;
        const seen: string[] = [];
        for (let pages = 0; pages < 10; pages++) {
            const p = await syncPage(w.db, since, 3);
            seen.push(...p.notes.map((n) => n.title));
            since = p.next;
            if (!p.more) break;
        }
        expect(seen).toHaveLength(7);
    });

    it("answers 410 sync.too_old to a client behind a trimmed delete marker, and 400 to a bad since", async () => {
        const w = world();
        const { token } = await w.session();
        const a = (await w.json("POST", "/notes", { token, body: { title: "a" } })).body.note.id;
        const behind = (await w.json("GET", "/sync", { token })).body.next;
        await w.json("POST", "/notes", { token, body: { title: "b" } });
        await w.json("DELETE", `/notes/${a}`, { token });
        // the marker's `at` is the database's clock: age it by hand
        w.db.raw.prepare("UPDATE changes SET at = 0 WHERE gone = 1").run();
        await cleanup(w.db, Date.now());
        expect(await w.json("GET", `/sync?since=${behind}`, { token })).toMatchObject({ status: 410, body: { error: "sync.too_old" } });
        // a fresh pull works and ends at or after the watermark
        const fresh = await w.json("GET", "/sync?since=0", { token });
        expect(fresh.status).toBe(200);
        expect((await w.json("GET", `/sync?since=${fresh.body.next}`, { token })).status).toBe(200);
        expect((await w.json("GET", "/sync?since=abc", { token })).status).toBe(400);
        // a cursor from the future (a reset database) starts again too
        expect((await w.json("GET", "/sync?since=999999", { token })).status).toBe(410);
        expect(GONE_KEEP_MS).toBe(30 * 86400_000);
    });

    it("lets a first load page through rows below the trim watermark", async () => {
        const w = world();
        const { token } = await w.session();
        for (let i = 0; i < 5; i++) await w.json("POST", "/notes", { token, body: { title: `n${i}` } });
        const doomed = (await w.json("POST", "/notes", { token, body: { title: "doomed" } })).body.note.id;
        await w.json("DELETE", `/notes/${doomed}`, { token });
        w.db.raw.prepare("UPDATE changes SET at = 0 WHERE gone = 1").run();
        await cleanup(w.db, Date.now());
        let since = 0;
        const seen: string[] = [];
        for (let pages = 0; pages < 10; pages++) {
            const p = await syncPage(w.db, since, 2);
            seen.push(...p.notes.map((n) => n.title));
            since = p.next;
            if (!p.more) break;
        }
        expect(seen.sort()).toEqual(["n0", "n1", "n2", "n3", "n4"]);
    });
});
