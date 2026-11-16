// The web Worker's bindings (web/cloudflare.config.ts). Handlers take `env` as a parameter so tests can pass fakes;
// only the +server.ts glue imports the real one from `cloudflare:workers`.
export interface Env {
    ASSETS: Fetcher;
    DB: D1Database;
    // Service binding to the capystack-api Worker (server-side loads; the browser talks to API_URL directly).
    API: Fetcher;
    ACCESS_TEAM_DOMAIN: string; // e.g. example.cloudflareaccess.com
    ACCESS_AUD: string; // Access application AUD tag
    OWNER_EMAIL: string;
    // The one Origin allowed to POST/DELETE (CSRF). Optional: defaults to the request's own origin.
    WEB_ORIGIN?: string;
    API_URL: string; // https://capystack-api.capybaraharmony.com
    POSTHOG_HOST: string;
    POSTHOG_TOKEN: string; // public-safe; empty = analytics off
}
