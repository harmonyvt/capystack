// The API Worker's bindings (cloudflare.config.ts declares them). Every optional one switches a feature off when it is
// missing or empty, so a fresh deploy with no secrets still answers: features in GET /capabilities say what is on.
// Written by hand (Wrangler's type generation is off); keep it in step with cloudflare.config.ts.

// The structural part of a Durable Object namespace the code uses (tests pass fakes).
export type DoNamespace = {
    idFromName(name: string): unknown;
    get(id: any, options?: { locationHint?: string }): { fetch(request: Request): Promise<Response> };
};

export type Env = {
    DB: D1Database;
    // Anthropic calls leave from this Durable Object, pinned to North America (src/model-fetch.ts).
    MODEL_RELAY?: DoNamespace;
    // One object per job: the demo job's progress and its Live Activity pushes, stepped by alarm() (src/job-runner.ts).
    JOB_RUNNER?: DoNamespace;
    // Secrets (cf deploy --secrets-file). Empty: the feature is off.
    ANTHROPIC_API_KEY?: string;
    APNS_KEY_P8?: string;
    APNS_KEY_ID?: string;
    APNS_TEAM_ID?: string;
    // Text bindings.
    CHAT_MODEL?: string;
    CORS_URL?: string;
    POSTHOG_HOST?: string;
    POSTHOG_TOKEN?: string;
    APNS_BUNDLE_ID?: string;
    // "auto" (each token's own env, the default) | "sandbox" | "production" (force one host for every token)
    APNS_ENV?: string;
};

export const APP_NAME = "capystack";
export const APP_VERSION = "0.1.0";
export const DEFAULT_CHAT_MODEL = "claude-haiku-5-5";

export const aiOn = (env: Pick<Env, "ANTHROPIC_API_KEY">) => (env.ANTHROPIC_API_KEY ?? "").trim() !== "";
export const chatModel = (env: Pick<Env, "CHAT_MODEL">) => (env.CHAT_MODEL ?? "").trim() || DEFAULT_CHAT_MODEL;
