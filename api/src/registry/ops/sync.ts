// GET /sync?since=N (docs/CONTRACT.md section 5): what changed since a change number, one D1 batch (src/sync.ts).
import * as z from "zod";
import { syncPage } from "../../sync";
import { defineOp, ok } from "../op";
import { NoteShape } from "../shapes";

export const syncPullOp = defineOp({
    name: "sync.pull",
    doc: "What changed since a change number (one page of at most 500 changes).",
    route: { method: "GET", path: "/sync" },
    auth: "key",
    input: z.object({ since: z.string().regex(/^\d{1,16}$/).optional().describe("the last page's `next`; 0 or absent for a first load") }),
    output: z.object({
        since: z.number().int(),
        next: z.number().int().describe("send as `since` next time"),
        more: z.boolean().describe("another page is waiting: ask again at once"),
        notes: z.array(NoteShape),
        gone: z.array(z.object({ entity: z.string(), id: z.string() })),
    }),
    handler: async (ctx, input) => ok(await syncPage(ctx.db, Number(input.since ?? "0"))),
});

export const SYNC_OPS = [syncPullOp];
