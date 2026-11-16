// POST /mcp (docs/CONTRACT.md section 7): the MCP server for Claude Code, claude.ai and other hosts, authenticated with a
// Bearer key for tools (any live token works). Stateless Streamable HTTP: one JSON-RPC message or batch per POST, answered
// with JSON. The protocol side (src/mcp/server.ts, the SDK) is loaded on the first MCP request, not on every cold start.
// GET (an SSE stream) and DELETE (ending a session) answer 405, as the spec asks of a server that has neither.
import * as z from "zod";
import { defineOp } from "../op";

// Bodies above this are refused before they are parsed (a tools/call is small).
export const MCP_BODY_MAX = 1_000_000;

const rpcError = (status: number, code: number, message: string) =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });

const NoInput = z.object({}).loose();
const none = () => ({});

export const mcpOp = defineOp({
    name: "mcp",
    doc: "The MCP server (Streamable HTTP, stateless, JSON answers).",
    route: { method: "POST", path: "/mcp" },
    auth: "key",
    raw: true,
    input: NoInput,
    http: none,
    handler: async (ctx) => {
        const request = ctx.request!;
        if (Number(request.headers.get("content-length") ?? "0") > MCP_BODY_MAX) return rpcError(413, -32600, "request too large");
        const text = await request.text();
        if (text.length > MCP_BODY_MAX) return rpcError(413, -32600, "request too large");
        let body: unknown;
        try {
            body = JSON.parse(text);
        } catch {
            return rpcError(400, -32700, "parse error");
        }
        if (Array.isArray(body) && body.length === 0) return rpcError(400, -32600, "empty batch");
        const { serveMcpRequest } = await import("../../mcp/server");
        return serveMcpRequest(ctx, request, body);
    },
});

const notHere = (name: string, method: "GET" | "DELETE", doc: string) =>
    defineOp({
        name,
        doc,
        route: { method, path: "/mcp" },
        auth: "open",
        raw: true,
        input: NoInput,
        http: none,
        handler: async () => new Response(null, { status: 405, headers: { allow: "POST" } }),
    });

export const MCP_OPS = [mcpOp, notHere("mcp.stream", "GET", "405: no server-sent event stream."), notHere("mcp.end", "DELETE", "405: no sessions to end.")];
