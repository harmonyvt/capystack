// POST /mcp (docs/CONTRACT.md section 7): the official SDK's server over the registry, stateless JSON answers, Bearer
// auth, the ops with mcp: true as tools, and the show_notes app tool with its widget.
import { describe, expect, it } from "vitest";
import { world, type World } from "./world";

const rpc = async (w: World, token: string | undefined, method: string, params: unknown = {}, id = 1) => {
    const r = await w.json("POST", "/mcp", { token, body: { jsonrpc: "2.0", id, method, params }, headers: { accept: "application/json, text/event-stream" } });
    return r;
};

describe("MCP", () => {
    it("needs a key", async () => {
        const w = world();
        expect(await rpc(w, undefined, "tools/list")).toMatchObject({ status: 401, body: { error: "auth.required" } });
    });

    it("initializes and lists the tools", async () => {
        const w = world();
        const { token } = await w.key("claude");
        const init = await rpc(w, token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
        expect(init.status).toBe(200);
        expect(init.body.result).toMatchObject({ serverInfo: { name: "capystack" }, capabilities: { tools: {} } });

        const list = await rpc(w, token, "tools/list");
        const tools = list.body.result.tools as any[];
        expect(tools.map((t) => t.name)).toEqual(["show_notes", "notes_list", "notes_get", "notes_create", "notes_update", "notes_delete"]);
        expect(tools.find((t) => t.name === "notes_delete").annotations).toMatchObject({ destructiveHint: true });
        expect(tools.find((t) => t.name === "notes_list").annotations).toMatchObject({ readOnlyHint: true });
        expect(tools.find((t) => t.name === "show_notes")._meta).toMatchObject({ ui: { resourceUri: "ui://capystack/notes" } });
        expect(tools.find((t) => t.name === "notes_create").inputSchema).toMatchObject({ type: "object" });
    });

    it("calls a tool as the key, with text and structuredContent", async () => {
        const w = world();
        const { token } = await w.key();
        const made = await rpc(w, token, "tools/call", { name: "notes_create", arguments: { title: "from claude", body: "hi" } });
        expect(made.status).toBe(200);
        const res = made.body.result;
        expect(res.isError).toBeUndefined();
        expect(res.structuredContent.note).toMatchObject({ title: "from claude" });
        expect(JSON.parse(res.content[0].text).note.title).toBe("from claude");

        const shown = await rpc(w, token, "tools/call", { name: "show_notes", arguments: {} });
        expect(shown.body.result.structuredContent.notes).toMatchObject([{ title: "from claude" }]);
        expect(shown.body.result.content[0].text).toContain("from claude");

        const bad = await rpc(w, token, "tools/call", { name: "notes_get", arguments: { id: "nope" } });
        expect(bad.body.result.isError).toBe(true);
        const missing = await rpc(w, token, "tools/call", { name: "notes_get", arguments: { id: "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b" } });
        expect(missing.body.result).toMatchObject({ isError: true, content: [{ text: "notes_get failed: notes.not_found" }] });
        const unknown = await rpc(w, token, "tools/call", { name: "nope", arguments: {} });
        expect(unknown.body.error).toBeDefined();
    });

    it("serves the widget as an MCP App resource", async () => {
        const w = world();
        const { token } = await w.key();
        const list = await rpc(w, token, "resources/list");
        expect(list.body.result.resources).toMatchObject([{ uri: "ui://capystack/notes", mimeType: "text/html;profile=mcp-app" }]);
        const read = await rpc(w, token, "resources/read", { uri: "ui://capystack/notes" });
        const html = read.body.result.contents[0].text as string;
        expect(html.startsWith("<!doctype html>")).toBe(true);
        expect(html).toContain("--color-surface");
        expect(html).not.toContain("/*JS*/");
    });

    it("answers 405 to GET and DELETE, and a parse error to bad JSON", async () => {
        const w = world();
        const { token } = await w.key();
        expect((await w.call("GET", "/mcp")).status).toBe(405);
        expect((await w.call("DELETE", "/mcp")).status).toBe(405);
        expect(await w.json("POST", "/mcp", { token, body: "{" })).toMatchObject({ status: 400, body: { error: { code: -32700 } } });
    });
});
