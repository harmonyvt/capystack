// The notes sync client (src/lib/client/notes.svelte.ts) against a stubbed fetch that plays the API.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../src/lib/client/notes.svelte";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
	getItem: (k: string) => mem.get(k) ?? null,
	setItem: (k: string, v: string) => void mem.set(k, v),
	removeItem: (k: string) => void mem.delete(k),
	key: (i: number) => [...mem.keys()][i] ?? null,
	get length() {
		return mem.size;
	},
});
Object.defineProperty(globalThis.localStorage, "__keys", { value: () => [...mem.keys()] });

const N = await import("../src/lib/client/notes.svelte");

type Call = { method: string; path: string; key: string | null; body: any };
let calls: Call[];
let server: Map<string, Note>;
let seq: number;
let log: { seq: number; id: string; gone: boolean }[];
let offline: boolean;
let status401: number; // answer this many requests with 401 first
let tooOld: boolean;

const touch = (id: string, gone: boolean) => {
	log = log.filter((l) => l.id !== id);
	log.push({ seq: ++seq, id, gone });
};

const answer = (status: number, body: unknown = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
	vi.useFakeTimers(); // the store's debounce timers must not fire between steps
	mem.clear();
	mem.set("capystack.token", JSON.stringify("t".repeat(43)));
	calls = [];
	server = new Map();
	seq = 0;
	log = [];
	offline = false;
	status401 = 0;
	tooOld = false;
	N.resetNotes();
	N.loadCache();
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string, init: RequestInit = {}) => {
			if (offline) throw new TypeError("offline");
			const url = new URL(input, "https://capystack.capybaraharmony.com");
			const headers = init.headers as Record<string, string>;
			const call: Call = { method: init.method ?? "GET", path: url.pathname + url.search, key: headers?.["idempotency-key"] ?? null, body: init.body ? JSON.parse(init.body as string) : null };
			calls.push(call);
			if (url.pathname === "/api/auth/web") return answer(200, { token: "n".repeat(43) });
			if (status401 > 0) {
				status401--;
				return answer(401, { error: "auth.required" });
			}
			const m = /^\/notes(?:\/([^/]+))?$/.exec(url.pathname);
			if (m && call.method === "POST") {
				if (server.has(call.body.id)) return answer(409, { error: "notes.exists" });
				const note = { id: call.body.id, title: call.body.title, body: call.body.body, created_at: 1, updated_at: 1 };
				server.set(note.id, note);
				touch(note.id, false);
				return answer(201, { note });
			}
			if (m && call.method === "PATCH") {
				const n = server.get(m[1]!);
				if (!n) return answer(404, { error: "notes.not_found" });
				Object.assign(n, call.body, { updated_at: n.updated_at + 1 });
				touch(n.id, false);
				return answer(200, { note: n });
			}
			if (m && call.method === "DELETE") {
				if (!server.delete(m[1]!)) return answer(404, { error: "notes.not_found" });
				touch(m[1]!, true);
				return answer(204);
			}
			if (url.pathname === "/sync") {
				if (tooOld && url.searchParams.get("since") !== "0") return answer(410, { error: "sync.too_old" });
				const since = Number(url.searchParams.get("since"));
				const page = log.filter((l) => l.seq > since);
				return answer(200, {
					since,
					next: page.length ? page[page.length - 1]!.seq : since,
					more: false,
					notes: page.filter((l) => !l.gone).map((l) => server.get(l.id)),
					gone: page.filter((l) => l.gone).map((l) => ({ entity: "note", id: l.id })),
				});
			}
			return answer(404, { error: "not_found" });
		}),
	);
});

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

const writes = () => calls.filter((c) => c.method !== "GET");

describe("optimistic writes and the outbox", () => {
	it("a new note shows at once and is sent once with its own id and an Idempotency-Key", async () => {
		const n = N.createNote();
		expect(N.data.notes.map((x) => x.id)).toEqual([n.id]);
		expect(N.sync.pending).toBe(1);
		await N.flush();
		expect(writes()).toHaveLength(1);
		expect(writes()[0]).toMatchObject({ method: "POST", path: "/notes", body: { id: n.id } });
		expect(writes()[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
		expect(N.sync.pending).toBe(0);
		expect(server.has(n.id)).toBe(true);
	});
	it("edits before the first send are merged into the create", async () => {
		const n = N.createNote();
		N.updateNote(n.id, { title: "a" });
		N.updateNote(n.id, { body: "b" });
		N.updateNote(n.id, { title: "ab" });
		await N.flush();
		expect(writes()).toHaveLength(1);
		expect(writes()[0]!.body).toMatchObject({ id: n.id, title: "ab", body: "b" });
	});
	it("a note deleted before it was ever sent never touches the network", async () => {
		const n = N.createNote();
		N.deleteNote(n.id);
		await N.flush();
		expect(writes()).toEqual([]);
		expect(N.data.notes).toEqual([]);
		expect(N.sync.pending).toBe(0);
	});
	it("edits to a synced note become one PATCH; delete sends DELETE and drops queued edits", async () => {
		const n = N.createNote();
		await N.flush();
		calls.length = 0;
		N.updateNote(n.id, { title: "x" });
		N.updateNote(n.id, { body: "y" });
		await N.flush();
		expect(writes().map((c) => [c.method, c.body])).toEqual([["PATCH", { title: "x", body: "y" }]]);
		calls.length = 0;
		N.updateNote(n.id, { title: "z" });
		N.deleteNote(n.id);
		await N.flush();
		expect(writes().map((c) => c.method)).toEqual(["DELETE"]);
		expect(server.size).toBe(0);
	});
	it("offline: the outbox is kept, the status says offline, and the next flush sends it", async () => {
		offline = true;
		const n = N.createNote();
		await N.flush();
		expect(N.sync.status).toBe("offline");
		expect(N.sync.pending).toBe(1);
		await vi.advanceTimersByTimeAsync(200); // the cache is written on a short timer
		expect(JSON.parse(mem.get("capystack.outbox")!)).toHaveLength(1);
		offline = false;
		await N.flush();
		expect(N.sync.pending).toBe(0);
		expect(server.has(n.id)).toBe(true);
	});
	it("a create that already exists (409, a replay) continues as an update", async () => {
		const n = N.createNote();
		N.updateNote(n.id, { title: "mine" });
		server.set(n.id, { id: n.id, title: "old", body: "", created_at: 1, updated_at: 1 });
		await N.flush();
		expect(writes().map((c) => c.method)).toEqual(["POST", "PATCH"]);
		expect(server.get(n.id)!.title).toBe("mine");
	});
	it("an edit the server refuses for good (404) is dropped and the pull restores the truth", async () => {
		const n = N.createNote();
		await N.flush();
		server.delete(n.id);
		touch(n.id, true);
		N.updateNote(n.id, { title: "late" });
		await N.flush();
		expect(N.sync.pending).toBe(0);
		await N.pull();
		expect(N.data.notes).toEqual([]);
	});
});

describe("pull", () => {
	it("applies notes and deletes (entity 'note'), keeps the cursor, and does not overwrite unsent local edits", async () => {
		server.set("a", { id: "a", title: "A", body: "", created_at: 1, updated_at: 5 });
		server.set("b", { id: "b", title: "B", body: "", created_at: 1, updated_at: 6 });
		touch("a", false);
		touch("b", false);
		await N.pull();
		expect(N.data.notes.map((n) => n.id).sort()).toEqual(["a", "b"]);

		offline = true;
		N.updateNote("a", { title: "local" });
		offline = false;
		server.get("a")!.title = "remote";
		touch("a", false);
		server.delete("b");
		touch("b", true);
		const since = calls.length;
		await N.pull();
		expect(N.data.notes.find((n) => n.id === "a")!.title).toBe("local");
		expect(N.data.notes.find((n) => n.id === "b")).toBeUndefined();
		expect(calls.slice(since).find((c) => c.path.startsWith("/sync"))!.path).toBe("/sync?since=2");
	});
	it("410 sync.too_old: drops the copy and pulls from 0", async () => {
		server.set("a", { id: "a", title: "A", body: "", created_at: 1, updated_at: 1 });
		touch("a", false);
		await N.pull();
		server.set("c", { id: "c", title: "C", body: "", created_at: 1, updated_at: 1 });
		touch("c", false);
		tooOld = true;
		await N.pull();
		expect(calls.filter((c) => c.path === "/sync?since=0").length).toBeGreaterThanOrEqual(2);
		expect(N.data.notes.map((n) => n.id).sort()).toEqual(["a", "c"]);
	});
	it("a 401 mints a new session once and retries", async () => {
		status401 = 1;
		await N.pull();
		expect(calls.map((c) => c.path)).toEqual(["/sync?since=0", "/api/auth/web", "/sync?since=0"]);
		expect(calls[1]!.body).toEqual({ replace: "t".repeat(43) });
		expect(JSON.parse(mem.get("capystack.token")!)).toBe("n".repeat(43));
	});
});
