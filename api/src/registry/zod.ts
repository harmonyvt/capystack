// Zod helpers shared by the HTTP side, the chat tools and the MCP tools.
import * as z from "zod";

// A failed check as one line a person or a model can act on.
export function zodMessage(name: string, e: z.ZodError): string {
    const parts = e.issues.slice(0, 4).map((i) => `${i.path.length ? i.path.join(".") : "input"}: ${i.message}`);
    return `${name}: ${parts.join("; ")}`;
}

type Json = Record<string, unknown>;

// A zod schema as JSON Schema, as a client sends it (`io: "input"`) or reads it (`"output"`), always an object.
export function jsonSchemaOf(schema: z.ZodType, io: "input" | "output" = "input"): Json {
    let out: Json;
    try {
        out = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any", io }) as Json;
    } catch {
        out = { type: "object" };
    }
    delete out.$schema;
    if (out.type !== "object") return { type: "object", additionalProperties: true };
    return out;
}
