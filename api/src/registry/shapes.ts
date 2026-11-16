// Reply shapes (docs/CONTRACT.md section 4) for openapi.json. They describe the JSON the handlers already answer; they
// never build or rewrite a reply. `.meta({ id })` makes each a named component.
import * as z from "zod";

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const Uuid = z.string().regex(UUID_REGEX, "a lowercase UUID");
const Ms = z.number().int().describe("ms since the epoch");

export const ErrorShape = z.object({ error: z.string().describe("dotted code, e.g. auth.required"), message: z.string().optional() }).meta({ id: "Error" });

export const NoteShape = z
    .object({ id: z.string(), title: z.string(), body: z.string(), created_at: Ms, updated_at: Ms })
    .meta({ id: "Note" });

export const JobShape = z
    .object({
        id: z.string(),
        kind: z.literal("demo"),
        state: z.enum(["running", "done", "failed"]),
        progress: z.number().min(0).max(1),
        title: z.string(),
        created_at: Ms,
        updated_at: Ms,
    })
    .meta({ id: "Job" });

export const SessionShape = z
    .object({
        id: z.string(),
        kind: z.enum(["session", "key"]),
        name: z.string(),
        device: z.string().nullable(),
        platform: z.string().nullable(),
        created_at: Ms,
        last_used_at: Ms.nullable().describe("written at most once a day"),
        expires_at: Ms.nullable().describe("sessions: slides to 90 days after use; keys: null"),
    })
    .meta({ id: "Session" });

export const SessionRowShape = SessionShape.extend({ current: z.boolean().describe("the caller's own session") }).meta({ id: "SessionRow" });

export const KeyShape = z.object({ id: z.string(), name: z.string(), created_at: Ms, last_used_at: Ms.nullable() }).meta({ id: "Key" });

export const ThreadShape = z.object({ id: z.string(), title: z.string(), created_at: Ms, updated_at: Ms }).meta({ id: "ChatThread" });

export const MessageShape = z
    .object({
        id: z.string(),
        thread_id: z.string(),
        role: z.enum(["user", "assistant"]),
        content: z.array(z.looseObject({ type: z.string() })).describe("Anthropic content blocks: text, tool_use, tool_result"),
        text: z.string().describe("the text blocks joined (empty for a tool turn)"),
        created_at: Ms,
    })
    .meta({ id: "ChatMessage" });

export const PushTokenShape = z
    .object({
        id: z.string(),
        kind: z.enum(["device", "live_start", "live_update"]),
        platform: z.string(),
        env: z.enum(["sandbox", "production"]),
        activity_id: z.string().nullable(),
        created_at: Ms,
        updated_at: Ms,
    })
    .meta({ id: "PushToken" });

export const OkShape = z.object({ ok: z.literal(true) });
