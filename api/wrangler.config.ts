// Bundler settings only. The deploy tool is the Cloudflare `cf` CLI (cloudflare.config.ts); cf hands the build to the
// local Wrangler devDependency, so never run `wrangler login` or `wrangler deploy` here. Types are written by hand in
// src/env.ts, so Wrangler's type generation stays off.
import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
    types: {
        generate: false,
    },
});
