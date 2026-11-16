// GET /capabilities: what this server can do, read by every client at start (docs/CONTRACT.md section 4). Open: the
// apps read it before sign-in to know whether to show AI and push. The PostHog token is a write-only project token,
// safe to hand out (PostHog puts it in every client).
import * as z from "zod";
import { apnsConfigFrom } from "../../apns";
import { aiOn, APP_NAME, APP_VERSION } from "../../env";
import { DEFAULT_HOST, postHogConfig } from "../../posthog";
import { defineOp, ok } from "../op";

export const capabilitiesOp = defineOp({
    name: "system.capabilities",
    doc: "What this server can do: name, version, features and the PostHog project.",
    route: { method: "GET", path: "/capabilities" },
    auth: "open",
    input: z.object({}).loose(),
    output: z.object({
        name: z.string(),
        version: z.string(),
        features: z.object({ ai: z.boolean(), push: z.boolean(), posthog: z.boolean(), mcp: z.boolean() }),
        posthog: z.object({ host: z.string(), token: z.string() }),
    }),
    handler: async (ctx) => {
        const ph = postHogConfig(ctx.env);
        return ok({
            name: APP_NAME,
            version: APP_VERSION,
            features: { ai: aiOn(ctx.env), push: apnsConfigFrom(ctx.env) !== null, posthog: ph !== null, mcp: true },
            posthog: { host: ph?.host ?? DEFAULT_HOST, token: ph?.token ?? "" },
        });
    },
});

export const SYSTEM_OPS = [capabilitiesOp];
