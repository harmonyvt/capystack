// Tests run under plain node (node:sqlite stands in for D1, fakes for the Durable Objects and APNs): nothing here needs
// workerd. `cloudflare:workers` is only imported by src/index.ts and the Durable Object files, which no test loads.
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["test/**/*.test.ts"],
    },
});
