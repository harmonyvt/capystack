# containers/helper (optional, off by default)

A Cloudflare Container for work a Worker cannot do: native binaries (ffmpeg, yt-dlp), long CPU, `node:http2`, big
files on disk. Ported from cobalt's `deploy/cloudflare/api/helper`. Nothing in `api/` uses it until you switch it on;
a deploy without it costs nothing.

The image is `Dockerfile` + `server.js`: a plain Node server on port 8080. Every route but `GET /health` needs the
`x-internal-key` header to equal `HELPER_KEY`, which only the Worker knows. Clients never reach the container: the
Worker checks their Bearer token first and calls the container through a Durable Object.

## Switch it on

1. `cd api && npm install @cloudflare/containers`
2. A Durable Object class for it, e.g. `api/src/helper.ts` (imported only from `src/index.ts`):

   ```ts
   import { Container } from "@cloudflare/containers";
   import type { Env } from "./env";

   export class Helper extends Container<Env & { HELPER_KEY: string }> {
       defaultPort = 8080;
       sleepAfter = "2m";
       // the env is read when the container starts; change it and the next start picks it up
       envVars = { HELPER_KEY: this.env.HELPER_KEY };
   }
   ```

   and `export { Helper } from "./helper";` in `src/index.ts`.
3. In `api/cloudflare.config.ts`:

   ```ts
   import { bindings, defineConfig, defineContainer, exports, triggers } from "cf/config";

   const helper = defineContainer({
       name: "capystack-api-helper",
       image: { dockerfile: "../containers/helper/Dockerfile", buildContext: "../containers/helper" },
       instanceType: "basic", // 1/4 vCPU, 1 GiB; standard-1 for ffmpeg
       observability: { enabled: true, logs: { enabled: true } },
       maxInstances: 1,
   });
   // env:      HELPER: bindings.durableObject({ worker: "capystack-api", exportName: "Helper" }),
   //           HELPER_KEY: bindings.secret(),
   // exports:  Helper: exports.durableObject({ storage: "sqlite", container: helper }),
   // top level: containers: [helper],
   ```
4. Add `"HELPER_KEY": "<a fresh UUID>"` to `~/.config/capystack/secrets.json`.
5. Call it from an op: `env.HELPER.get(env.HELPER.idFromName("main")).fetch(new Request("http://helper/echo", { method: "POST", headers: { "x-internal-key": env.HELPER_KEY }, body }))`.
6. `npm run dry-run` in `api/`, then deploy.

## Lessons carried over from cobalt

- Strip `cf-container-target-port` from every client request before it reaches a Durable Object: `Container.fetch()`
  honours it, so a client could pick any port inside the container.
- A container rollout restarts instances with their old env. Put the Worker's version id in `envVars` if each deploy
  must restart the container onto new code.
- `AbortSignal` timeouts on `containerFetch` are not honoured inside the Durable Object: race your own timeout.
- Work after a Durable Object's response does not survive: make long jobs poll-driven or alarm-driven.
