# capystack contract

The one document every part of the template builds against. Lanes (api, web, apple, design/deploy) each own their
folders and meet only at what is written here. Change this file first, then the code.

The template is distilled from harmonyvt/cobalt (`deploy/cloudflare/`, `apple/`). When a pattern here says "as in
cobalt", read the named cobalt file and port its idea, minus capystore features (media, library, share, stage, 7TV,
swarms, workbench, yt-dlp, editor, transcripts, embeddings).

## 0. Names and placeholders

Everything app-specific comes from `app.config.json`. `./init` rewrites these literal strings across the repo, so code
must spell them exactly like this (and nowhere else invent variants):

| Placeholder | Meaning |
|---|---|
| `capystack` | slug: Worker names `capystack-api` / `capystack-web`, D1 name, URL scheme, secrets dir `~/.config/capystack/` |
| `CAPYSTACK` | env var prefix, e.g. `CAPYSTACK_SECRETS` (path override for the secrets file) |
| `Capystack` | Swift prefix: package `CapystackKit`, app target `Capystack`, widgets `CapystackWidgets`, `CapystackApp` |
| `capystack.capybaraharmony.com` | web host (behind Cloudflare Access) |
| `capystack-api.capybaraharmony.com` | API host (one subdomain level so Universal SSL covers it) |
| `com.capybaraharmony.capystack` | bundle id (widgets: `.widgets`), app group `group.com.capybaraharmony.capystack` |

Display copy uses lowercase `capystack`.

Secrets file keys (every key must exist, empty = feature off; `cf deploy` refuses a declared secret missing from the
file): `ANTHROPIC_API_KEY`, `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`. The API's `bindings.secret()` list must equal
`SECRET_KEYS` in `deploy/app-deploy`.

## 1. Repo layout and ownership

```
app.config.json            the app's identity (owner: main thread)
init                       rename script (design/deploy lane)
api/                       API Worker (api lane)
d1/migrations/             D1 schema (api lane)
web/                       SvelteKit app + web Worker (web lane)
design/                    tokens.json + build.mjs (design lane)
mockups/                   HTML mockups + gallery (design lane)
apple/                     XcodeGen project, CapystackKit, app, widgets (apple lane)
containers/helper/         optional container, off by default (api lane)
deploy/                    app-deploy + apple scripts (design/deploy lane)
docs/                      CONTRACT.md (main), RUNBOOK.md, LESSONS.md (design/deploy lane)
AGENTS.md, CLAUDE.md, DESIGN.md, README.md   (design/deploy lane)
```

Generated files have one writer:
- `api/scripts/gen.mjs` writes `api/openapi.json` and `apple/CapystackKit/Sources/CapystackKit/API/Endpoints.generated.swift`.
- `design/build.mjs` writes `web/src/lib/design/tokens.css` and `apple/Capystack/Design/Tokens.generated.swift`.

## 2. Architecture

- **API Worker** `capystack-api` on `capystack-api.capybaraharmony.com`: every route is an op (`defineOp`, section 4).
  D1 bound as `DB`. Durable Objects: `ModelRelay` (Anthropic calls, pinned `enam`), `JobRunner` (demo job + Live
  Activity pushes, alarm-driven). Cron `*/15 * * * *` (cleanup). `placement: { region }` from app.config (Worker next to
  D1: each sequential D1 call from a far edge costs ~190 ms; see cobalt's cloudflare.config.ts comment).
- **Web Worker** `capystack-web` on `capystack.capybaraharmony.com`: SvelteKit (Svelte 5, adapter-cloudflare). Cloudflare
  Access in front (owner only). Its server routes `/api/auth/*` and `/api/keys*` verify the Access JWT themselves and
  write D1 (same `DB`). Pages call the API host directly with a Bearer session token (CORS allows only the web origin).
  Service binding `API` to the API Worker for server-side loads.
- **Apps** (iPhone, iPad, Mac): sign in through the web host in `ASWebAuthenticationSession`, then talk only to the API.

## 3. Auth

- Header: `Authorization: Bearer <token>` everywhere (apps, web, MCP). Tokens are random 32-byte base64url; D1 stores
  only `sha256` hex. Lookup caches 60 s per isolate.
- Two kinds in `api_keys.kind`: `session` (a signed-in device; 90-day sliding expiry, bumped at most once a day; at most
  50) and `key` (a named "key for tools": MCP, scripts; no expiry until revoked).
- App sign-in (as in cobalt `web/src/auth.ts` + API `/auth/exchange`):
  1. App makes a PKCE verifier, opens `https://capystack.capybaraharmony.com/api/auth/app?challenge=<S256>&platform=ios|ipados|mac&device=<name>`.
  2. Access logs the owner in; the web Worker verifies the JWT email == `OWNER_EMAIL`, stores a one-time code
     (2 min) in `auth_handoffs`, answers 302 to `capystack://signed-in?code=<code>`.
  3. App calls `POST /auth/exchange {code, verifier, device, platform}` → `{token, session}`.
- Web sign-in: the page calls `POST /api/auth/web` (same origin, Access cookie) → `{token, session}`; kept in
  localStorage, re-minted on 401.
- 401 body `{error:"auth.required"}`; the clients show "sign in again".

## 4. API (op registry)

`api/src/registry/` as in cobalt: `defineOp({ name, route:{method,path}, auth, input: zod, ai?: {tier, call, line}, mcp?, handler })`.
- `auth`: `"open" | "session" | "key"` (`key` accepts both kinds; `session` = signed-in devices only, for account pages).
- `ai.tier`: `"free"` (chat + MCP may call), `"ask"` (MCP marks destructiveHint; chat returns pending), `"hidden"`.
- Errors: `{ error: "<dotted.code>", message? }`, HTTP status as usual. Unknown route: 404 `{error:"not_found"}`.
- `Idempotency-Key` header on writes is honoured (7-day table); write replies carry `x-change-seq`.

Routes (op name → method path):

| op | route | auth | notes |
|---|---|---|---|
| `system.capabilities` | GET /capabilities | open | `{name, version, features:{ai, push, posthog, mcp}, posthog:{host, token}}` |
| `auth.exchange` | POST /auth/exchange | open | section 3 |
| `auth.me` | GET /auth/me | key | `{session:{id, kind, name, device, platform, created_at, last_used_at, expires_at}}` |
| `auth.sessions` | GET /auth/sessions | session | `{sessions:[...]}` |
| `auth.revoke` | DELETE /auth/sessions/:id | session | |
| `auth.signout` | POST /auth/signout | key | revokes the caller |
| `keys.list` | GET /auth/keys | session | `{keys:[{id,name,created_at,last_used_at}]}` |
| `keys.create` | POST /auth/keys `{name}` | session | `{key:{...}, token}` (token shown once) |
| `keys.revoke` | DELETE /auth/keys/:id | session | |
| `notes.list` | GET /notes?limit&before | key | `{notes:[Note], next}`; ai free, mcp |
| `notes.get` | GET /notes/:id | key | `{note}`; ai free, mcp |
| `notes.create` | POST /notes `{title, body, id?}` | key | client may send its own id (offline create); ai free, mcp |
| `notes.update` | PATCH /notes/:id `{title?, body?}` | key | ai free, mcp |
| `notes.delete` | DELETE /notes/:id | key | ai ask, mcp |
| `notes.summarize` | POST /notes/:id/summarize | key | Haiku via ModelRelay → `{summary}`; 503 `ai.off` without key |
| `sync.pull` | GET /sync?since=<seq> | key | section 5 |
| `chat.create` | POST /chat/threads `{title?}` | key | `{thread}` |
| `chat.list` | GET /chat/threads | key | |
| `chat.get` | GET /chat/threads/:id | key | `{thread, messages}` |
| `chat.send` | POST /chat/threads/:id/messages `{text}` | key | runs the model with the AI ops as tools (tool-use loop, max 8 turns), stores and returns new messages |
| `push.register` | POST /push/tokens `{kind:"device"\|"live_start"\|"live_update", token, platform, env:"sandbox"\|"production", activity_id?}` | key | upsert per key+kind(+activity) |
| `push.unregister` | DELETE /push/tokens/:id | key | |
| `jobs.demo` | POST /jobs/demo `{seconds?: 5..120}` | key | starts a JobRunner; Live Activity push-to-start then updates |
| `jobs.get` | GET /jobs/:id | key | `{job}` |
| `mcp` | POST /mcp | key | section 7 |

Note: `{id, title, body, created_at, updated_at}`; ids are lowercase UUIDs; times are ms since epoch (integers).
Job: `{id, kind:"demo", state:"running"|"done"|"failed", progress 0..1, title, created_at, updated_at}`.

## 5. Sync (CloudKit's design against D1, as in cobalt `api/src/sync.ts` + `CobaltKit/Sync/`)

- D1 table `changes(seq INTEGER PRIMARY KEY AUTOINCREMENT, entity, id, gone, at)` filled by triggers on `notes`
  (insert/update → gone 0, delete → gone 1; one row per entity+id, older rows for it deleted by the trigger).
- `GET /sync?since=N` → `{since, next, more, notes:[Note], gone:[{entity, id}]}`, at most 500 changes per page, one
  D1 batch. `since` older than the oldest kept delete marker (30 days) → 410 `{error:"sync.too_old"}`: client drops its
  copy and pulls from 0.
- Client: local SQLite (no third-party), an outbox of pending writes sent with `Idempotency-Key`, pull after each push
  and on foreground. A `device` push (APNs background, `content-available`) after a write from another device is a hint
  to pull; nothing else rides on it.

## 6. AI

- Every Anthropic call goes through `ModelRelay` (`api/src/model-fetch.ts` + `model-relay.ts`, copied from cobalt):
  Cloudflare HKG/SIN egress gets 403 from Anthropic. `@anthropic-ai/sdk` with `fetch: relayFetch(env.MODEL_RELAY)`.
- Model from `CHAT_MODEL` (default `claude-haiku-5-5`). Off (features.ai false) when `ANTHROPIC_API_KEY` is empty.
- Chat tools = ops with an `ai` tier, as plain Anthropic tool definitions generated from the zod input.

## 7. MCP

- `POST /mcp` (Streamable HTTP, stateless) on the official SDK (`@modelcontextprotocol/server`, as cobalt
  `src/mcp-app/server.ts`). Tools = ops with `mcp: true` (names: op name with `.` → `_`, e.g. `notes_list`).
- One MCP App tool `show_notes` with widget `ui://capystack/notes` (one HTML bundle in `api/src/mcp/widgets/`, built by
  `npm run widgets` into a generated TS string). Tools answer text + `structuredContent`.
- Auth Bearer key (a "key for tools"). Setup lines for Claude Code / claude.ai live in docs/RUNBOOK.md.

## 8. Push and Live Activities

- APNs token auth (ES256 JWT from `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`), topic `com.capybaraharmony.capystack`
  (Live Activity topic `<bundle>.push-type.liveactivity`). Port cobalt `api/src/apns.ts`. Missing secrets → features.push false.
- One device gets server-started islands: the newest `live_start` token on platform `ios`, else any (cobalt lesson:
  the iPad stole an island).
- ActivityAttributes `JobActivityAttributes { jobId: String; kind: String }`, ContentState
  `{ title: String, progress: Double, state: String, updatedAt: Date }` (JSON keys exactly these; dates as seconds since
  1970 in the push payload `content-state`). Never `.fixedSize()` on a timer Text in a Live Activity.
- JobRunner DO: work after a DO response does not survive, so progress steps run from `alarm()` (every 2 s).

## 9. PostHog

- Server: one `op` event per route/chat/MCP call (`{op, status, ms, via:"http"|"chat"|"mcp"}`), warn/error logs, cron
  runs; sent with `ctx.waitUntil`, never changes an answer (port cobalt `api/src/posthog.ts`). distinct_id = key id.
- Apps: `posthog-ios` in the app target only; token + host from `/capabilities`; any view that draws user content wears
  `.privacyMask()` (the template's `.mediaMask()`).
- Web: posthog-js loaded lazily when the token is set.

## 10. D1 schema (`d1/migrations/0001_init.sql`)

`api_keys(id TEXT PK, kind TEXT, name TEXT, token_hash TEXT UNIQUE, device TEXT, platform TEXT, created_at, last_used_at, expires_at, revoked_at)`,
`auth_handoffs(code_hash PK, challenge, platform, device, expires_at)`, `notes(id PK, title, body, created_at, updated_at)`,
`changes(...)` + triggers, `idempotency(key, key_id, status, body, created_at, PK(key,key_id))`,
`push_tokens(id PK, key_id, kind, token, platform, env, activity_id, created_at, updated_at)`,
`jobs(id PK, kind, state, progress, title, key_id, created_at, updated_at)`,
`chat_threads(id PK, key_id, title, created_at, updated_at)`, `chat_messages(id PK, thread_id, role, content_json, created_at)`.

## 11. Design system (design lane writes tokens, each client writes its own components)

Token names (tokens.json → CSS `--<group>-<name>` with dark values under `prefers-color-scheme: dark`; Swift
`enum Tokens { enum Color, Space, Radius, Font, Motion }`):
- color (light/dark pairs): `bg, surface, surface-raised, text, text-muted, border, accent, accent-text, danger, success`
- space: `1..8` on a 4 pt scale (4, 8, 12, 16, 20, 24, 32, 48)
- radius: `sm 8, md 12, lg 20, pill 999`
- font: `family` (system stack / SF), sizes `caption 12, body 15, headline 17, title 22, large 30`, weights
- motion: `fast 0.15s, base 0.25s, slow 0.4s`, spring `response 0.35, damping 0.8`

Swift names: `Tokens.Color.surfaceRaised`, `Tokens.Space.s4`, `Tokens.Radius.md`, `Tokens.Font.body`, `Tokens.Motion.spring`.

Component kit (web in `web/src/lib/ui/`, SwiftUI in `apple/Capystack/Design/`; SwiftUI avoids shadowing its own
`Button`/`TextField`: button styles `.primary/.secondary/.ghost/.danger` + `.kit(_:fullWidth:)`, `InputField`, `ToastMessage`
+ `.toastHost`):
`Button` (primary, secondary, ghost, danger), `IconButton` (icon-first, name on hover/long-press), `Sheet` (close at top
right), `ListRow`, `EmptyState`, `Skeleton`, `Toast`, `SignInCard`, `TextField`.

House style: lowercase copy, short and friendly, no emoji anywhere in the UI, icon-first controls, closes top right,
skeletons instead of spinners, haptics on meaningful changes (apps). Copy lives in one place per area
(`web/src/lib/copy.ts`, `apple/Capystack/Design/Copy.swift`).

## 12. Gates (commands that must pass)

- api: `cd api && npm ci && npm test && npm run typecheck && npm run gen:check && npm run widgets:check`
- web: `cd web && npm ci && npm run check && npm test && npm run build`
- design: `node design/build.mjs --check`
- apple (Mac only): `cd apple && xcodegen generate`, then `xcodebuild ... build` for iOS Simulator and macOS, and
  `cd apple/CapystackKit && swift test`.

## 13. Decisions made while building (2026-11-16)

- `sync_state(id = 1, trimmed_seq)` holds the trim watermark for the 410 rule; a cursor ahead of the newest change
  (a reset database) also gets 410. `next` can exceed plain seqs during a first load after a trim
  (`trimmed_seq * 1e9 + seq`): clients store it as Int64 and send it back unchanged. The sync entity name is `note`.
- `GET /mcp` and `DELETE /mcp` answer 405 (stateless server, no event stream).
- `APNS_ENV`: `auto` (each token's own env) or `sandbox` / `production` to force one host.
- `chat.send` answers `{thread, messages}`; a message is `{id, thread_id, role, content (Anthropic blocks), text, created_at}`.
  An `ask`-tier tool called from chat answers `{pending_confirm:{tool, input}}`; there is no confirm flow yet.
- After any notes write (HTTP, chat or MCP) the server sends a silent `device` push to every other key: "pull now".
- `defineOp` also takes `doc`, `badRequest`, `output` and `raw`.
- The cron also fails jobs running over 15 min, deletes jobs done over 7 days, keys revoked/expired over 30 days, and push
  tokens of dead keys.
- The web deploy config lives in `web/deploy/` (cf delegates to Wrangler only outside a Vite project) and is deployed
  WITHOUT a secrets file: the web Worker declares no secrets.
- Error codes: `auth.required` (401), `auth.session_required` (403), `auth.forbidden` (403, web Access), `unavailable`
  (503), `bad_request`, `not_found`, `cors.origin`, `idempotency.bad_key`, `internal`, plus per-area `<area>.<reason>`.
