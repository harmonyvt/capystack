// The MCP server (docs/CONTRACT.md section 7), as cobalt's src/mcp-app/server.ts: the official SDK's low-level Server and
// its web-standard Streamable HTTP transport, one of each per request (stateless, JSON answers, no session id, no SSE).
// The low-level class rather than McpServer because the tools come from the op registry (names, descriptions, input
// schemas generated from zod) and must reach the client as they are. The validator is the SDK's @cfworker one (an
// interpreter): nothing compiles code at runtime, which Workers forbid. Free of Cloudflare imports: the tests run it.
import { ProtocolError, ProtocolErrorCode, Server, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { APP_NAME, APP_VERSION } from "../env";
import { describeOp, runOp } from "../registry/ai";
import { forCall } from "../registry/context";
import { OpError, type Op, type OpContext } from "../registry/op";
import { jsonSchemaOf } from "../registry/zod";
import { APP_TOOLS, type AppTool } from "./tools";
import { WIDGETS } from "./widgets.generated";

type Json = Record<string, unknown>;

export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
// A tool's text answer is cut here.
export const MCP_RESULT_MAX = 100_000;

export const INSTRUCTIONS = [
    "capystack holds the owner's notes. notes_list lists them (newest change first), notes_get reads one, notes_create, notes_update and notes_delete change them.",
    "show_notes draws the notes as a card where the host shows widgets.",
    "Tools marked destructive delete things for good: confirm with the user first.",
].join("\n");

export type McpTool = { name: string; title?: string; description: string; inputSchema: Json; annotations?: Json; _meta?: Json };
type Content = { type: "text"; text: string };
export type ToolResult = { content: Content[]; isError?: boolean; structuredContent?: Json };

const cut = (text: string) => (text.length > MCP_RESULT_MAX ? `${text.slice(0, MCP_RESULT_MAX)}… (cut: ask for less)` : text);

const errorText = (name: string, e: unknown) => {
    if (e instanceof OpError) return e.message === e.code ? `${name} failed: ${e.code}` : e.message;
    return `${name} failed`;
};

// An op as an MCP tool.
export function opTool(op: Op): McpTool {
    return {
        name: op.toolName,
        description: describeOp(op),
        inputSchema: jsonSchemaOf(op.input, "input"),
        annotations: op.tier === "ask" ? { destructiveHint: true, readOnlyHint: false } : { readOnlyHint: op.route.method === "GET" },
    };
}

// An app tool, tied to its widget by _meta (the nested key and the legacy flat one, as registerAppTool writes them).
export function appTool(t: AppTool): McpTool {
    return {
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: jsonSchemaOf(t.input, "input"),
        annotations: { readOnlyHint: true },
        _meta: { ui: { resourceUri: t.widget }, [RESOURCE_URI_META_KEY]: t.widget },
    };
}

export function toolList(ctx: OpContext): McpTool[] {
    return [...APP_TOOLS.map(appTool), ...ctx.registry.mcpOps().map(opTool)];
}

// The JSON answer as text, and as structuredContent when it is an object.
const answer = (value: unknown): ToolResult => ({
    content: [{ type: "text", text: cut(JSON.stringify(value ?? null, null, 1)) }],
    ...(value && typeof value === "object" && !Array.isArray(value) ? { structuredContent: value as Json } : {}),
});

export async function callTool(ctx: OpContext, name: string, args: unknown): Promise<ToolResult> {
    const mcpCtx = forCall(ctx, { caller: ctx.caller, via: "mcp" });
    const app = APP_TOOLS.find((t) => t.name === name);
    if (app) {
        const parsed = app.input.safeParse(args ?? {});
        if (!parsed.success) return { content: [{ type: "text", text: `${name}: ${parsed.error.issues[0]?.message ?? "bad input"}` }], isError: true };
        try {
            const r = await app.run(mcpCtx, parsed.data);
            return { content: [{ type: "text", text: cut(r.text) }], structuredContent: r.structured };
        } catch (e) {
            return { content: [{ type: "text", text: errorText(name, e) }], isError: true };
        }
    }
    const op = ctx.registry.mcpOps().find((o) => o.toolName === name);
    if (!op) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `unknown tool ${name}`);
    try {
        return answer(await runOp(op, mcpCtx, args));
    } catch (e) {
        return { content: [{ type: "text", text: errorText(name, e) }], isError: true };
    }
}

// What a widget's sandbox may load and call: nothing but itself (it only draws the tool result).
const widgetMeta = (): Json => ({ ui: { csp: { resourceDomains: [], connectDomains: [] } } });

function buildServer(ctx: OpContext): Server {
    const server = new Server(
        { name: APP_NAME, title: APP_NAME, version: APP_VERSION },
        {
            capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} },
            instructions: INSTRUCTIONS,
            supportedProtocolVersions: [...MCP_PROTOCOL_VERSIONS],
            jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
        },
    );
    server.setRequestHandler("tools/list", async () => ({ tools: toolList(ctx) as never }));
    server.setRequestHandler("tools/call", async (req) => {
        const a = req.params.arguments;
        const args = a && typeof a === "object" && !Array.isArray(a) ? a : {};
        return (await callTool(ctx, req.params.name, args)) as never;
    });
    server.setRequestHandler("resources/list", async () => ({
        resources: WIDGETS.map((w) => ({ uri: w.uri, name: w.name, title: w.title, mimeType: RESOURCE_MIME_TYPE })),
    }));
    server.setRequestHandler("resources/templates/list", async () => ({ resourceTemplates: [] }));
    server.setRequestHandler("resources/read", async (req) => {
        const w = WIDGETS.find((x) => x.uri === req.params.uri);
        if (!w) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `unknown resource ${req.params.uri}`);
        return { contents: [{ uri: w.uri, mimeType: RESOURCE_MIME_TYPE, text: w.html, _meta: widgetMeta() }] };
    });
    server.setRequestHandler("prompts/list", async () => ({ prompts: [] }));
    return server;
}

// One POST answered. `body` is the parsed JSON-RPC message (or batch). The transport is told the request is JSON that
// accepts JSON whatever the client sent, since some clients send neither header.
export async function serveMcpRequest(ctx: OpContext, request: Request, body: unknown): Promise<Response> {
    const server = buildServer(ctx);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    headers.set("accept", "application/json, text/event-stream");
    // the SDK answers 400 to a protocol version it does not know; an unknown one is dropped instead
    const asked = headers.get("mcp-protocol-version");
    if (asked !== null && !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked)) headers.delete("mcp-protocol-version");
    try {
        return await transport.handleRequest(new Request(request.url, { method: "POST", headers }), { parsedBody: body });
    } finally {
        await server.close().catch(() => {});
    }
}
