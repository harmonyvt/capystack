// The chat (docs/CONTRACT.md section 6): the tool-use loop with a scripted model. Free tools run as the caller, ask tools
// do not run, every turn is stored and replayed next time.
import { describe, expect, it } from "vitest";
import { MAX_TURNS } from "../src/chat";
import { FakeModel, world } from "./world";

const text = (t: string) => ({ type: "text", text: t, citations: null });

describe("chat", () => {
    it("answers 503 ai.off without a model, 404 for an unknown thread", async () => {
        const w = world();
        const { token } = await w.session();
        const thread = (await w.json("POST", "/chat/threads", { token, body: {} })).body.thread;
        expect(thread.title).toBe("new chat");
        expect(await w.json("POST", `/chat/threads/${thread.id}/messages`, { token, body: { text: "hi" } })).toMatchObject({ status: 503, body: { error: "ai.off" } });
        w.model = new FakeModel([]);
        expect((await w.json("POST", "/chat/threads/6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b/messages", { token, body: { text: "hi" } })).status).toBe(404);
    });

    it("runs a free tool, feeds the result back, and stores every turn", async () => {
        const model = new FakeModel([
            () => ({ stop_reason: "tool_use", content: [text("on it"), { type: "tool_use", id: "tu1", name: "notes_create", input: { title: "milk" } }] as never }),
            (p) => {
                const last = p.messages.at(-1)!;
                const result = (last.content as any[])[0];
                expect(result).toMatchObject({ type: "tool_result", tool_use_id: "tu1" });
                expect(JSON.parse(result.content).note.title).toBe("milk");
                return { content: [text("saved a note called milk")] as never };
            },
        ]);
        const w = world({ model });
        const { token } = await w.session();
        const thread = (await w.json("POST", "/chat/threads", { token, body: { title: "shopping" } })).body.thread;
        const sent = await w.json("POST", `/chat/threads/${thread.id}/messages`, { token, body: { text: "remember milk" } });
        expect(sent.status).toBe(200);
        expect(sent.body.messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
        expect(sent.body.messages.at(-1).text).toBe("saved a note called milk");
        expect((await w.json("GET", "/notes", { token })).body.notes).toMatchObject([{ title: "milk" }]);
        // the tools are the AI ops
        expect(model.calls[0]!.tools!.map((t: any) => t.name)).toContain("notes_delete");
        expect(model.calls[0]!.model).toBe("claude-haiku-5-5");

        const got = await w.json("GET", `/chat/threads/${thread.id}`, { token });
        expect(got.body.messages).toHaveLength(4);
        expect((await w.json("GET", "/chat/threads", { token })).body.threads).toMatchObject([{ id: thread.id, title: "shopping" }]);

        // the next message replays the whole thread
        model.messages.create = (async (p: any) => {
            expect(p.messages).toHaveLength(5);
            return { content: [text("ok")], stop_reason: "end_turn" };
        }) as never;
        expect((await w.json("POST", `/chat/threads/${thread.id}/messages`, { token, body: { text: "thanks" } })).body.messages).toHaveLength(2);
    });

    it("does not run an ask tool: the model is told it waits for the owner", async () => {
        const w = world();
        const { token } = await w.session();
        const note = (await w.json("POST", "/notes", { token, body: { title: "keep me" } })).body.note;
        w.model = new FakeModel([
            () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu1", name: "notes_delete", input: { id: note.id } }] as never }),
            (p) => {
                const result = (p.messages.at(-1)!.content as any[])[0];
                expect(JSON.parse(result.content)).toEqual({ pending_confirm: { tool: "notes_delete", input: { id: note.id } } });
                return { content: [text("you can delete it in the app")] as never };
            },
        ]);
        const thread = (await w.json("POST", "/chat/threads", { token, body: {} })).body.thread;
        expect((await w.json("POST", `/chat/threads/${thread.id}/messages`, { token, body: { text: "delete it" } })).status).toBe(200);
        expect((await w.json("GET", `/notes/${note.id}`, { token })).status).toBe(200);
    });

    it("tells the model about a failed tool and stops after MAX_TURNS", async () => {
        const loop = () => ({ stop_reason: "tool_use" as const, content: [{ type: "tool_use", id: `tu${Math.random()}`, name: "notes_get", input: { id: "bad" } }] as never });
        const model = new FakeModel(Array.from({ length: MAX_TURNS + 2 }, () => loop));
        const w = world({ model });
        const { token } = await w.session();
        const thread = (await w.json("POST", "/chat/threads", { token, body: {} })).body.thread;
        const sent = await w.json("POST", `/chat/threads/${thread.id}/messages`, { token, body: { text: "go" } });
        expect(model.calls).toHaveLength(MAX_TURNS);
        const firstResult = sent.body.messages[2].content[0];
        expect(firstResult).toMatchObject({ type: "tool_result", is_error: true });
        expect(firstResult.content).toContain("notes_get");
    });
});
