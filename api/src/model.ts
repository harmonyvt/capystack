// The Anthropic client the chat and notes.summarize use: the official SDK with its fetch routed through ModelRelay
// (src/model-fetch.ts). `ModelClient` is the one method the code calls, so tests hand in a fake. No Cloudflare imports.
import Anthropic from "@anthropic-ai/sdk";
import { aiOn, type Env } from "./env";
import { relayFetch } from "./model-fetch";

export type ModelMessage = Anthropic.Messages.Message;
export type ModelParams = Anthropic.Messages.MessageCreateParamsNonStreaming;
export type ModelClient = { messages: { create(params: ModelParams): Promise<ModelMessage> } };

// The client, or null while ANTHROPIC_API_KEY is empty (features.ai false). Without a relay binding (local runs) the
// SDK uses the plain fetch.
export function modelFrom(env: Env): ModelClient | null {
    if (!aiOn(env)) return null;
    return new Anthropic({
        apiKey: env.ANTHROPIC_API_KEY!.trim(),
        ...(env.MODEL_RELAY ? { fetch: relayFetch(env.MODEL_RELAY) } : {}),
        maxRetries: 1,
    }) as unknown as ModelClient;
}

// The text blocks of a reply, joined.
export const textOf = (m: Pick<ModelMessage, "content">) =>
    m.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
