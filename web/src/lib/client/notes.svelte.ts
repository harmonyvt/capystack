// Notes with a small sync client (contract section 5, the web's copy of CloudKit's design against D1):
//  - the cache (notes, cursor, outbox) lives in localStorage and is read synchronously, so the list is there on the
//    first paint, before any request;
//  - every edit is applied locally first (optimistic) and queued in an outbox of writes, each sent with its own
//    Idempotency-Key, in order, one at a time;
//  - after a push, and on start, focus, `online` and every 30 s while visible, GET /sync?since=<cursor> pulls what
//    changed. Local notes with writes still queued are not overwritten by a pull.
import { ApiError, api } from "./api";
import { store } from "./storage";

export type Note = { id: string; title: string; body: string; created_at: number; updated_at: number };
type Patch = { title?: string; body?: string };
export type Op = { key: string; kind: "create" | "update" | "delete"; id: string; patch?: Patch; note?: Note };
type SyncPage = { since: number; next: number; more: boolean; notes: Note[]; gone: { entity: string; id: string }[] };

export type SyncStatus = "idle" | "syncing" | "offline" | "error";
export const sync = $state<{ status: SyncStatus; pending: number; loaded: boolean }>({ status: "idle", pending: 0, loaded: false });
export const data = $state<{ notes: Note[] }>({ notes: [] });

let cursor = 0;
let outbox: Op[] = [];
let inFlight: string | null = null; // key of the op on the wire (not mergeable)
let flushing = false;
let pulling: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

const uuid = () => crypto.randomUUID();
const byRecent = (a: Note, b: Note) => b.updated_at - a.updated_at || (a.id < b.id ? 1 : -1);

function persist() {
	clearTimeout(persistTimer);
	persistTimer = setTimeout(() => {
		store.set("notes", data.notes);
		store.set("cursor", cursor);
		store.set("outbox", outbox);
	}, 150);
}

function touch() {
	data.notes.sort(byRecent);
	sync.pending = outbox.length;
	persist();
}

export function loadCache() {
	data.notes = store.get<Note[]>("notes", []).sort(byRecent);
	cursor = store.get<number>("cursor", 0);
	outbox = store.get<Op[]>("outbox", []);
	sync.pending = outbox.length;
	sync.loaded = true;
}

// Test hook and sign-out: forget everything cached for this browser.
export function resetNotes() {
	data.notes = [];
	cursor = 0;
	outbox = [];
	inFlight = null;
	sync.pending = 0;
	sync.status = "idle";
	store.remove("notes");
	store.remove("cursor");
	store.remove("outbox");
}

const queued = (id: string) => outbox.find((o) => o.id === id && o.key !== inFlight);

export function createNote(): Note {
	const now = Date.now();
	const note: Note = { id: uuid(), title: "", body: "", created_at: now, updated_at: now };
	data.notes.unshift(note);
	outbox.push({ key: uuid(), kind: "create", id: note.id, note: { ...note } });
	touch();
	scheduleFlush(0);
	return note;
}

export function updateNote(id: string, patch: Patch) {
	const note = data.notes.find((n) => n.id === id);
	if (!note) return;
	if (patch.title !== undefined) note.title = patch.title;
	if (patch.body !== undefined) note.body = patch.body;
	note.updated_at = Date.now();
	const op = queued(id);
	if (op?.kind === "create" && op.note) {
		Object.assign(op.note, patch);
		op.key = uuid(); // payload changed: a retry must not replay the old answer
	} else if (op?.kind === "update") {
		op.patch = { ...op.patch, ...patch };
		op.key = uuid();
	} else {
		outbox.push({ key: uuid(), kind: "update", id, patch: { ...patch } });
	}
	touch();
	scheduleFlush(600);
}

export function deleteNote(id: string) {
	const i = data.notes.findIndex((n) => n.id === id);
	if (i < 0) return;
	data.notes.splice(i, 1);
	const create = outbox.find((o) => o.id === id && o.kind === "create" && o.key !== inFlight);
	// A note the server never heard of just disappears; otherwise drop its queued edits and send the delete.
	outbox = outbox.filter((o) => o.id !== id || o.key === inFlight);
	if (!create) outbox.push({ key: uuid(), kind: "delete", id });
	touch();
	scheduleFlush(0);
}

function scheduleFlush(ms: number) {
	clearTimeout(flushTimer);
	flushTimer = setTimeout(() => void flush(), ms);
}

function request(op: Op): Promise<unknown> {
	const opts = { idempotencyKey: op.key };
	if (op.kind === "create") return api("/notes", { ...opts, method: "POST", body: { id: op.id, title: op.note?.title ?? "", body: op.note?.body ?? "" } });
	if (op.kind === "update") return api(`/notes/${op.id}`, { ...opts, method: "PATCH", body: op.patch });
	return api(`/notes/${op.id}`, { ...opts, method: "DELETE" });
}

// Sends the outbox in order. Returns when it is empty or a send could not complete (offline, server error).
export async function flush(): Promise<void> {
	if (flushing) return;
	flushing = true;
	let sent = 0;
	try {
		while (outbox.length) {
			const op = outbox[0]!;
			inFlight = op.key;
			sync.status = "syncing";
			try {
				await request(op);
				outbox = outbox.filter((o) => o !== op);
				sent++;
			} catch (e) {
				if (e instanceof ApiError && e.isNetwork) {
					sync.status = "offline";
					return;
				}
				if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) {
					// The server refused this write for good. A create that already exists continues as an update;
					// anything else (404 on an edit of a note someone deleted, a bad body) is dropped and the pull
					// puts the server's truth back.
					outbox = outbox.filter((o) => o !== op);
					if (op.kind === "create" && e.status === 409 && op.note) {
						outbox.unshift({ key: uuid(), kind: "update", id: op.id, patch: { title: op.note.title, body: op.note.body } });
					}
					continue;
				}
				sync.status = "error";
				return;
			} finally {
				inFlight = null;
				touch();
			}
		}
	} finally {
		flushing = false;
		inFlight = null;
	}
	if (sent) await pull();
	else if (sync.status === "syncing") sync.status = "idle";
}

// GET /sync until `more` is false. 410 sync.too_old: drop the copy and start again from 0.
export function pull(): Promise<void> {
	pulling ??= (async () => {
		if (flushing) return;
		sync.status = "syncing";
		try {
			for (let guard = 0; guard < 200; guard++) {
				let page: SyncPage;
				try {
					page = await api<SyncPage>(`/sync?since=${cursor}`);
				} catch (e) {
					if (e instanceof ApiError && e.status === 410) {
						data.notes = outbox.length ? data.notes.filter((n) => outbox.some((o) => o.id === n.id)) : [];
						cursor = 0;
						continue;
					}
					throw e;
				}
				apply(page);
				if (!page.more) break;
			}
			sync.status = "idle";
			if (outbox.length && !flushing) scheduleFlush(0);
		} catch (e) {
			sync.status = e instanceof ApiError && e.isNetwork ? "offline" : "error";
		}
	})().finally(() => (pulling = null));
	return pulling;
}

export function apply(page: SyncPage) {
	const pending = new Set(outbox.map((o) => o.id));
	for (const n of page.notes) {
		if (pending.has(n.id)) continue;
		const i = data.notes.findIndex((x) => x.id === n.id);
		if (i >= 0) data.notes[i] = n;
		else data.notes.push(n);
	}
	for (const g of page.gone) {
		if (g.entity !== "note" || pending.has(g.id)) continue;
		const i = data.notes.findIndex((x) => x.id === g.id);
		if (i >= 0) data.notes.splice(i, 1);
	}
	cursor = page.next;
	touch();
}

// Start syncing and keep at it; returns the cleanup.
export function startSync(): () => void {
	loadCache();
	const tick = () => {
		if (document.visibilityState === "visible") void flush().then(pull);
	};
	tick();
	const timer = setInterval(tick, 30_000);
	addEventListener("online", tick);
	document.addEventListener("visibilitychange", tick);
	return () => {
		clearInterval(timer);
		removeEventListener("online", tick);
		document.removeEventListener("visibilitychange", tick);
	};
}
