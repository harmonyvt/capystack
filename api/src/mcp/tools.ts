// The MCP App tools (docs/CONTRACT.md section 7): tools that end in a widget. One here, show_notes, drawn by the notes
// widget (src/mcp/widgets/, built into widgets.generated.ts). It runs notes.list as the caller and answers text for
// the model plus structuredContent for the widget.
import * as z from "zod";
import { runOp } from "../registry/ai";
import type { OpContext } from "../registry/op";
import { NOTES_WIDGET_URI } from "./widgets.generated";

export type AppTool = {
    name: string;
    title: string;
    description: string;
    widget: string;
    input: z.ZodType;
    run(ctx: OpContext, input: any): Promise<{ text: string; structured: Record<string, unknown> }>;
};

type ListAnswer = { notes: { id: string; title: string; body: string; updated_at: number }[]; next: string | null };

export const showNotes: AppTool = {
    name: "show_notes",
    title: "show notes",
    description: "Show the owner's latest notes as a card (title, first line, when it changed). Use it when the user wants to see their notes.",
    widget: NOTES_WIDGET_URI,
    input: z.object({ limit: z.number().int().min(1).max(50).optional().describe("how many, default 10") }),
    async run(ctx, input: { limit?: number }) {
        const op = ctx.registry.op("notes.list")!;
        const list = (await runOp(op, ctx, { limit: input.limit ?? 10 })) as ListAnswer;
        const lines = list.notes.map((n) => `- ${n.title || "untitled"} (${n.id})`);
        const text = list.notes.length === 0 ? "No notes yet." : `${list.notes.length} notes:\n${lines.join("\n")}`;
        return { text, structured: { notes: list.notes, next: list.next } };
    },
};

export const APP_TOOLS: AppTool[] = [showNotes];
