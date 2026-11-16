// The chat (docs/CONTRACT.md section 6): one thread of messages in D1, answered by Haiku with the AI ops as tools. A plain
// tool-use loop (at most MAX_TURNS model calls per message): the model asks for tools, each `free` op runs as the caller,
// each `ask` op does not run and the model is told it waits for the owner. Every turn is stored as the Anthropic content
// blocks it was, so the next message replays the thread exactly. No Cloudflare imports.
import { chatModel } from "./env";
import type { ModelClient, ModelMessage, ModelParams } from "./model";
import { anthropicTools, runOp } from "./registry/ai";
import { forCall } from "./registry/context";
import { OpError, type OpContext } from "./registry/op";

export const MAX_TURNS = 8;
export const HISTORY_MAX = 60;
export const TEXT_MAX = 20_000;
export const TOOL_RESULT_MAX = 50_000;

export const CHAT_SYSTEM = [
    "you are the assistant inside capystack, the owner's notes app.",
    "you can read, write, change and delete the owner's notes with the tools. use them instead of guessing.",
    "answer short, lowercase, plain and friendly. no emoji.",
    "a tool that answers pending_confirm did not run: tell the owner what you asked and that they can do it in the app.",
].join("\n");

type Block = Record<string, unknown> & { type: string };
export type StoredMessage = { id: string; thread_id: string; role: "user" | "assistant"; content: Block[]; text: string; created_at: number };
type Row = { id: string; thread_id: string; role: "user" | "assistant"; content_json: string; created_at: number };

export const textOfBlocks = (blocks: Block[]) =>
    blocks
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("\n")
        .trim();

export const messageBody = (r: Row): StoredMessage => {
    let content: Block[] = [];
    try {
        content = JSON.parse(r.content_json) as Block[];
    } catch {
        content = [];
    }
    return { id: r.id, thread_id: r.thread_id, role: r.role, content, text: textOfBlocks(content), created_at: r.created_at };
};

export async function threadMessages(db: D1Database, threadId: string, limit = 500): Promise<StoredMessage[]> {
    const rows = await db
        .prepare("SELECT id, thread_id, role, content_json, created_at FROM chat_messages WHERE thread_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2")
        .bind(threadId, limit)
        .all<Row>();
    return rows.results.reverse().map(messageBody);
}

// The history the model gets: the newest HISTORY_MAX messages, starting at a user message that is not a tool result
// (a tool result whose tool_use was cut off would be refused).
export function historyFor(messages: StoredMessage[]): { role: "user" | "assistant"; content: Block[] }[] {
    let h = messages.slice(-HISTORY_MAX);
    const start = h.findIndex((m) => m.role === "user" && !m.content.some((b) => b.type === "tool_result"));
    h = start < 0 ? [] : h.slice(start);
    return h.map((m) => ({ role: m.role, content: m.content }));
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}… (cut)` : s);

// One user message in, the new messages out (the user's, every assistant turn, every tool result turn).
export async function sendMessage(ctx: OpContext, model: ModelClient, threadId: string, text: string): Promise<StoredMessage[]> {
    const db = ctx.db;
    let clock = ctx.now();
    // strictly increasing, so the thread's order is the order the turns happened
    const tick = () => (clock = Math.max(clock + 1, ctx.now()));
    const added: StoredMessage[] = [];
    const store = async (role: "user" | "assistant", content: Block[]) => {
        const m: StoredMessage = { id: crypto.randomUUID(), thread_id: threadId, role, content, text: textOfBlocks(content), created_at: tick() };
        await db
            .prepare("INSERT INTO chat_messages (id, thread_id, role, content_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
            .bind(m.id, threadId, role, JSON.stringify(content), m.created_at)
            .run();
        added.push(m);
        return m;
    };

    const history = historyFor(await threadMessages(db, threadId, HISTORY_MAX));
    const user = await store("user", [{ type: "text", text: clip(text, TEXT_MAX) }]);
    const convo = [...history, { role: user.role, content: user.content }];
    const tools = anthropicTools(ctx.registry);
    const toolCtx = forCall(ctx, { caller: ctx.caller, via: "chat" });

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        const reply: ModelMessage = await model.messages.create({
            model: chatModel(ctx.env),
            max_tokens: 1024,
            system: CHAT_SYSTEM,
            tools: tools as ModelParams["tools"],
            messages: convo as unknown as ModelParams["messages"],
        });
        const content = reply.content as unknown as Block[];
        await store("assistant", content);
        convo.push({ role: "assistant", content });
        const uses = content.filter((b) => b.type === "tool_use");
        if (reply.stop_reason !== "tool_use" || uses.length === 0) break;
        const results: Block[] = [];
        for (const use of uses) {
            const op = ctx.registry.byTool(String(use.name));
            let out: string;
            let isError = false;
            if (!op) {
                out = `no tool named ${String(use.name)}`;
                isError = true;
            } else if (op.tier === "ask") {
                out = JSON.stringify({ pending_confirm: { tool: op.toolName, input: use.input ?? {} } });
            } else {
                try {
                    out = JSON.stringify(await runOp(op, toolCtx, use.input));
                } catch (e) {
                    isError = true;
                    out = e instanceof OpError ? (e.message === e.code ? `${op.toolName} failed: ${e.code}` : e.message) : "the tool failed";
                }
            }
            results.push({ type: "tool_result", tool_use_id: String(use.id), content: clip(out, TOOL_RESULT_MAX), ...(isError ? { is_error: true } : {}) });
        }
        await store("user", results);
        convo.push({ role: "user", content: results });
    }
    await db.prepare("UPDATE chat_threads SET updated_at = ?2 WHERE id = ?1").bind(threadId, tick()).run();
    return added;
}
