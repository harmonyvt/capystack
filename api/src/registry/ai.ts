// The registry's AI side (docs/CONTRACT.md sections 6 and 7): running an op for the chat model or an MCP client, and
// the ops as plain Anthropic tool definitions generated from their zod input. As cobalt's registry/ai.ts, minus its
// sandboxed code mode: here the model calls tools directly.
import { capture, opEvents } from "../posthog";
import { OpError, type Op, type OpContext } from "./op";
import type { Registry } from "./registry";
import { jsonSchemaOf, zodMessage } from "./zod";

// What the model reads after an `ask` tool's line (and the MCP description gets the same).
export const ASK_NOTE = "Changes or removes things for good: check with the owner first.";

// Runs an op for a non-HTTP caller with its raw arguments. Returns the 2xx body; a refusal throws OpError. Every call
// is one PostHog `op` event with `via` chat or mcp.
export async function runOp(op: Op, ctx: OpContext, args: unknown): Promise<unknown> {
    const started = ctx.now();
    let status = 0;
    let error: string | null = null;
    try {
        const parsed = op.input.safeParse(args ?? {});
        if (!parsed.success) throw new OpError(400, "bad_request", zodMessage(op.toolName, parsed.error));
        const out = await op.handler(ctx, parsed.data);
        let body: unknown;
        if (out instanceof Response) {
            status = out.status;
            body = await out.json().catch(() => null);
        } else {
            status = out.status;
            body = out.body;
        }
        if (status < 200 || status > 299) {
            const code = (body as { error?: unknown } | null)?.error;
            throw new OpError(status, typeof code === "string" ? code : "internal");
        }
        return body;
    } catch (e) {
        if (e instanceof OpError) {
            status = e.status;
            error = e.code;
        } else {
            status = 500;
            error = "internal";
        }
        throw e;
    } finally {
        void capture(ctx.env, ctx.waitUntil, opEvents({ op: op.name, status, ms: ctx.now() - started, via: ctx.via === "http" ? "chat" : ctx.via, keyId: ctx.caller?.id ?? null, error }, ctx.now()));
    }
}

export type AnthropicTool = { name: string; description: string; input_schema: Record<string, unknown> & { type: "object" } };

export const describeOp = (op: Op) => (op.tier === "ask" ? `${op.ai!.line} ${ASK_NOTE}` : op.ai!.line);

// The chat model's tools: every op with a free or ask tier.
export function anthropicTools(registry: Registry): AnthropicTool[] {
    return registry.aiOps().map((op) => ({
        name: op.toolName,
        description: describeOp(op),
        input_schema: jsonSchemaOf(op.input, "input") as AnthropicTool["input_schema"],
    }));
}
