// The op registry (docs/CONTRACT.md section 4), as in cobalt's api/src/registry/op.ts: every API feature is defined once
// with `defineOp`. One definition gives the HTTP route (method, path, auth, CORS), the input check (zod), the chat AI's
// tool (its tier and line) and, with `mcp: true`, an MCP tool. Free of Cloudflare imports: the tests run it under node.
import type { z } from "zod";
import type { Env } from "../env";
import type { KeyCache, Caller } from "../keys";
import type { ModelClient } from "../model";
import type { JobsPort } from "../jobs";
import type { ApnsSender } from "../apns";
import type { Registry } from "./registry";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// Who may call a route:
//  - "open":    anyone (ctx.caller is null).
//  - "key":     any live bearer token, a signed-in device ("session") or a key for tools ("key").
//  - "session": signed-in devices only (account pages); a key for tools gets 403 auth.session_required, so a leaked
//               tool key can never mint itself a spare or list the devices.
export type OpAuth = "open" | "key" | "session";

// How the chat AI and the MCP may use an op:
//  - "free":   chat and MCP call it directly.
//  - "ask":    MCP marks it destructiveHint; the chat does not run it and tells the model it waits for the owner.
//  - "hidden": never a tool (the default when `ai` is left out).
export type AiTier = "free" | "ask" | "hidden";

export type AiSpec = {
    tier: AiTier;
    // the tool's name in chat (default: the op name). Dots become underscores in tool names: notes.list -> notes_list.
    call?: string;
    // the one line the model reads about the tool
    line: string;
};

// A handler's reply: the HTTP status and JSON body (the AI gets `body` on a 2xx).
export type OpReply = { status: number; body: unknown; headers?: Record<string, string> };

// A handler's refusal: `{ error: code, message? }` over HTTP, and the words the model reads when the AI called it.
export class OpError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message?: string,
    ) {
        super(message ?? code);
    }
}

export const ok = (body: unknown, status = 200): OpReply => ({ status, body });

// Where a call came from (PostHog's `via`).
export type Via = "http" | "chat" | "mcp";

// What every op call sees. One shape for HTTP, chat and MCP calls.
export type OpContext = {
    env: Env;
    db: D1Database;
    now: () => number;
    // hands work that must not hold the answer to the runtime (ctx.waitUntil); absent in tests (then it is awaited)
    waitUntil?: (p: Promise<unknown>) => void;
    registry: Registry;
    keyCache?: KeyCache;
    // the Anthropic client (through ModelRelay), or null while ANTHROPIC_API_KEY is empty
    model: () => ModelClient | null;
    // starts a JobRunner (absent: jobs are off)
    jobs: JobsPort | null;
    // APNs, or null while the APNS_* secrets are missing
    apns: ApnsSender | null;
    // the verified caller (null on open routes)
    caller: Caller | null;
    via: Via;
    // HTTP calls only
    request?: Request;
    url?: URL;
    params: Record<string, string>;
    query: URLSearchParams;
};

export type RouteSpec = {
    method: HttpMethod;
    // "/notes/:id": each `:name` segment is a param (any non-empty segment)
    path: string;
};

export type OpDef<I = any> = {
    name: string;
    // one line for openapi.json (ops with an `ai` line use that instead)
    doc?: string;
    route: RouteSpec;
    auth: OpAuth;
    input: z.ZodType<I>;
    // the error code a failed input check answers (default bad_request)
    badRequest?: string;
    // a named reply shape for openapi.json (documentation only; never used to build a reply)
    output?: z.ZodType;
    ai?: AiSpec;
    // listed as an MCP tool (needs an ai tier other than hidden)
    mcp?: boolean;
    // the handler answers with its own Response (MCP)
    raw?: boolean;
    // How an HTTP request becomes the input. Default: query + path params, then the JSON body on POST/PUT/PATCH.
    http?: (ctx: OpContext) => unknown | Promise<unknown>;
    handler: (ctx: OpContext, input: I) => Promise<OpReply | Response>;
};

export type Op<I = any> = OpDef<I> & { tier: AiTier; callName: string; toolName: string };

export const toolNameOf = (call: string) => call.replace(/\./g, "_");

export function defineOp<I>(def: OpDef<I>): Op<I> {
    const tier = def.ai?.tier ?? "hidden";
    if (def.mcp && tier === "hidden") throw new Error(`op ${def.name}: an MCP tool needs an ai tier`);
    const callName = def.ai?.call ?? def.name;
    return { ...def, tier, callName, toolName: toolNameOf(callName) };
}
