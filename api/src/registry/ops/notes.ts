// Notes, the template's demo entity (docs/CONTRACT.md section 4): CRUD for every client, the chat model and MCP, plus a
// Haiku summary. Every write goes through the `changes` triggers (sync, section 5) and sends the owner's other devices a
// silent "pull now" push. Replace this file with your own entity; keep the shape of it.
import * as z from "zod";
import { chatModel } from "../../env";
import { textOf } from "../../model";
import { hintOtherDevices } from "../../push";
import { noteBody, type Note } from "../../sync";
import { defineOp, ok, OpError, type OpContext } from "../op";
import { NoteShape, OkShape, Uuid } from "../shapes";

export const TITLE_MAX = 200;
export const BODY_MAX = 100_000;
export const LIST_MAX = 100;

const COLUMNS = "id, title, body, created_at, updated_at";

async function noteById(ctx: OpContext, id: string): Promise<Note | null> {
    const row = await ctx.db.prepare(`SELECT ${COLUMNS} FROM notes WHERE id = ?1`).bind(id).first<Note>();
    return row ? noteBody(row) : null;
}

const mustFind = async (ctx: OpContext, id: string) => {
    const note = await noteById(ctx, id);
    if (!note) throw new OpError(404, "notes.not_found");
    return note;
};

const changed = (ctx: OpContext) => hintOtherDevices(ctx, ctx.caller?.id ?? null);

// The list cursor: "<updated_at>_<id>" of the last note on the page.
const cursorOf = (n: Note) => `${n.updated_at}_${n.id}`;
const CURSOR = /^(\d{1,16})_([0-9a-f-]{36})$/;

export const notesListOp = defineOp({
    name: "notes.list",
    route: { method: "GET", path: "/notes" },
    auth: "key",
    input: z.object({
        limit: z.coerce.number().int().min(1).max(LIST_MAX).optional().describe(`1..${LIST_MAX}, default 50`),
        before: z.string().regex(CURSOR).optional().describe("`next` of the previous page"),
    }),
    output: z.object({ notes: z.array(NoteShape).describe("most recently changed first"), next: z.string().nullable() }),
    ai: { tier: "free", line: "List the owner's notes, most recently changed first. Pass `before` (the previous answer's `next`) for older ones." },
    mcp: true,
    handler: async (ctx, input) => {
        const limit = input.limit ?? 50;
        const m = input.before ? CURSOR.exec(input.before) : null;
        const rows = m
            ? await ctx.db
                  .prepare(`SELECT ${COLUMNS} FROM notes WHERE (updated_at, id) < (?1, ?2) ORDER BY updated_at DESC, id DESC LIMIT ?3`)
                  .bind(Number(m[1]), m[2]!, limit + 1)
                  .all<Note>()
            : await ctx.db.prepare(`SELECT ${COLUMNS} FROM notes ORDER BY updated_at DESC, id DESC LIMIT ?1`).bind(limit + 1).all<Note>();
        const notes = rows.results.slice(0, limit).map(noteBody);
        return ok({ notes, next: rows.results.length > limit ? cursorOf(notes[notes.length - 1]!) : null });
    },
});

export const notesGetOp = defineOp({
    name: "notes.get",
    route: { method: "GET", path: "/notes/:id" },
    auth: "key",
    input: z.object({ id: Uuid }),
    output: z.object({ note: NoteShape }),
    ai: { tier: "free", line: "Read one note in full by its id." },
    mcp: true,
    handler: async (ctx, input) => ok({ note: await mustFind(ctx, input.id) }),
});

export const notesCreateOp = defineOp({
    name: "notes.create",
    route: { method: "POST", path: "/notes" },
    auth: "key",
    input: z.object({
        id: Uuid.optional().describe("the client's own id (offline create); a new one when left out"),
        title: z.string().max(TITLE_MAX).default(""),
        body: z.string().max(BODY_MAX).default(""),
    }),
    output: z.object({ note: NoteShape }),
    ai: { tier: "free", line: "Write a new note with a title and a body." },
    mcp: true,
    handler: async (ctx, input) => {
        const id = input.id ?? crypto.randomUUID();
        const now = ctx.now();
        const row = await ctx.db
            .prepare(`INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT (id) DO NOTHING RETURNING ${COLUMNS}`)
            .bind(id, input.title, input.body, now)
            .first<Note>();
        if (!row) throw new OpError(409, "notes.exists", "a note with this id already exists");
        await changed(ctx);
        return ok({ note: noteBody(row) }, 201);
    },
});

export const notesUpdateOp = defineOp({
    name: "notes.update",
    route: { method: "PATCH", path: "/notes/:id" },
    auth: "key",
    input: z.object({ id: Uuid, title: z.string().max(TITLE_MAX).optional(), body: z.string().max(BODY_MAX).optional() }),
    output: z.object({ note: NoteShape }),
    ai: { tier: "free", line: "Change a note's title and/or body (the fields left out stay)." },
    mcp: true,
    handler: async (ctx, input) => {
        const row = await ctx.db
            .prepare(
                `UPDATE notes SET title = COALESCE(?2, title), body = COALESCE(?3, body), updated_at = MAX(?4, updated_at + 1)
                  WHERE id = ?1 RETURNING ${COLUMNS}`,
            )
            .bind(input.id, input.title ?? null, input.body ?? null, ctx.now())
            .first<Note>();
        if (!row) throw new OpError(404, "notes.not_found");
        await changed(ctx);
        return ok({ note: noteBody(row) });
    },
});

export const notesDeleteOp = defineOp({
    name: "notes.delete",
    route: { method: "DELETE", path: "/notes/:id" },
    auth: "key",
    input: z.object({ id: Uuid }),
    output: OkShape,
    ai: { tier: "ask", line: "Delete a note for good." },
    mcp: true,
    handler: async (ctx, input) => {
        const r = await ctx.db.prepare("DELETE FROM notes WHERE id = ?1").bind(input.id).run();
        if (!r.meta.changes) throw new OpError(404, "notes.not_found");
        await changed(ctx);
        return ok({ ok: true });
    },
});

export const SUMMARY_SYSTEM =
    "You summarize one note for its owner in one or two short sentences. Lowercase, plain and friendly, no emoji, no preamble.";

export const notesSummarizeOp = defineOp({
    name: "notes.summarize",
    doc: "A one or two sentence summary of a note by the chat model.",
    route: { method: "POST", path: "/notes/:id/summarize" },
    auth: "key",
    input: z.object({ id: Uuid }),
    output: z.object({ summary: z.string() }),
    handler: async (ctx, input) => {
        const model = ctx.model();
        if (!model) throw new OpError(503, "ai.off", "AI is off on this server");
        const note = await mustFind(ctx, input.id);
        const reply = await model.messages.create({
            model: chatModel(ctx.env),
            max_tokens: 300,
            system: SUMMARY_SYSTEM,
            messages: [{ role: "user", content: `title: ${note.title}\n\n${note.body}`.slice(0, 50_000) }],
        });
        return ok({ summary: textOf(reply) });
    },
});

export const NOTE_OPS = [notesListOp, notesGetOp, notesCreateOp, notesUpdateOp, notesDeleteOp, notesSummarizeOp];
