// The chat's routes (docs/CONTRACT.md section 4): threads and messages in D1; POST .../messages runs the model with the
// AI ops as tools (src/chat.ts). 503 ai.off while ANTHROPIC_API_KEY is empty. Not tools themselves.
import * as z from "zod";
import { sendMessage, threadMessages } from "../../chat";
import { defineOp, ok, OpError, type OpContext } from "../op";
import { MessageShape, ThreadShape, Uuid } from "../shapes";

type ThreadRow = { id: string; title: string; created_at: number; updated_at: number };
const COLUMNS = "id, title, created_at, updated_at";

async function mustFindThread(ctx: OpContext, id: string): Promise<ThreadRow> {
    const t = await ctx.db.prepare(`SELECT ${COLUMNS} FROM chat_threads WHERE id = ?1`).bind(id).first<ThreadRow>();
    if (!t) throw new OpError(404, "chat.not_found");
    return t;
}

export const chatCreateOp = defineOp({
    name: "chat.create",
    doc: "Start a chat thread.",
    route: { method: "POST", path: "/chat/threads" },
    auth: "key",
    input: z.object({ title: z.string().max(200).optional() }),
    output: z.object({ thread: ThreadShape }),
    handler: async (ctx, input) => {
        const now = ctx.now();
        const thread: ThreadRow = { id: crypto.randomUUID(), title: input.title?.trim() || "new chat", created_at: now, updated_at: now };
        await ctx.db
            .prepare("INSERT INTO chat_threads (id, key_id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)")
            .bind(thread.id, ctx.caller!.id, thread.title, now)
            .run();
        return ok({ thread }, 201);
    },
});

export const chatListOp = defineOp({
    name: "chat.list",
    doc: "The chat threads, most recently used first.",
    route: { method: "GET", path: "/chat/threads" },
    auth: "key",
    input: z.object({}).loose(),
    output: z.object({ threads: z.array(ThreadShape).describe("most recently used first, at most 100") }),
    handler: async (ctx) => {
        const rows = await ctx.db.prepare(`SELECT ${COLUMNS} FROM chat_threads ORDER BY updated_at DESC, id DESC LIMIT 100`).all<ThreadRow>();
        return ok({ threads: rows.results });
    },
});

export const chatGetOp = defineOp({
    name: "chat.get",
    doc: "A chat thread and its messages.",
    route: { method: "GET", path: "/chat/threads/:id" },
    auth: "key",
    input: z.object({ id: Uuid }),
    output: z.object({ thread: ThreadShape, messages: z.array(MessageShape).describe("oldest first") }),
    handler: async (ctx, input) => {
        const thread = await mustFindThread(ctx, input.id);
        return ok({ thread, messages: await threadMessages(ctx.db, thread.id) });
    },
});

export const chatSendOp = defineOp({
    name: "chat.send",
    doc: "Send a message; the model answers, using the notes tools, and the new messages come back.",
    route: { method: "POST", path: "/chat/threads/:id/messages" },
    auth: "key",
    input: z.object({ id: Uuid, text: z.string().trim().min(1).max(20_000) }),
    output: z.object({ thread: ThreadShape, messages: z.array(MessageShape).describe("the new messages, oldest first") }),
    handler: async (ctx, input) => {
        const model = ctx.model();
        if (!model) throw new OpError(503, "ai.off", "AI is off on this server");
        await mustFindThread(ctx, input.id);
        const messages = await sendMessage(ctx, model, input.id, input.text);
        return ok({ thread: await mustFindThread(ctx, input.id), messages });
    },
});

export const CHAT_OPS = [chatCreateOp, chatListOp, chatGetOp, chatSendOp];
