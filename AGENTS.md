# AGENTS.md

The guide for any coding agent (Claude Code, Codex, Cursor, a person) working in this repo. Read it first, then
`docs/CONTRACT.md` (the binding spec), and `DESIGN.md` before any UI work.

## What this is

capystack is a template for a private, single-owner app: a SvelteKit web app and a native SwiftUI app (iPhone, iPad, Mac)
on one Cloudflare backend. A Worker API where every route is a declared "op" that also becomes a chat AI tool and an MCP
tool; D1 for data, Durable Objects for jobs and model calls, Cloudflare Access guarding the web host, per-owner Bearer
keys guarding the API, push and Live Activities, PostHog analytics. Notes are the demo feature; replace them with yours.
It is distilled from a production stack, and `docs/LESSONS.md` holds what that taught.

```
 iPhone / iPad / Mac app ──┐                                   ┌── Anthropic
 (SwiftUI, CapystackKit,   │  Bearer token                     │   (only via ModelRelay, pinned enam)
  local SQLite + outbox)   ├──────────▶  API Worker  ──────────┤
 Web app (SvelteKit)  ─────┤            (op registry)          ├── D1 (notes, keys, sync, jobs, chat)
 MCP clients (Claude, …) ──┘            │   │    │             ├── Durable Objects: ModelRelay, JobRunner
        ▲                               │   │    └─ cron 15m   └── APNs (push, Live Activities)
        │ Access JWT (owner only)       │   └─ /mcp (tools = ops, widgets)
   Web Worker ──service binding────────┘
 (static + /api/auth, /api/keys)
```

## Repo map

| path | what | owner lane |
|---|---|---|
| `app.config.json` | the app's identity: names, hosts, ids | main |
| `docs/CONTRACT.md` | the spec every lane builds against; change it first, then the code | main |
| `api/` | API Worker: `src/registry/` ops, `src/mcp/`, `scripts/gen.mjs`, tests | api |
| `d1/migrations/` | D1 schema, numbered, append-only | api |
| `web/` | SvelteKit app and web Worker; `src/lib/ui/` kit, `src/lib/copy.ts` | web |
| `apple/` | `project.yml` (XcodeGen), `CapystackKit/` package, `Capystack/` app, widgets | apple |
| `containers/helper/` | optional container, off by default | api |
| `design/` | `tokens.json`, `build.mjs` (writes the two token files) | design |
| `mockups/` | HTML mockups, `shoot.mjs` screenshots | design |
| `deploy/` | `app-deploy`, `apple/*.sh`, `test-init.sh` | design |
| `init` | renames the template into your app | design |
| `AGENTS.md`, `CLAUDE.md`, `DESIGN.md`, `README.md`, `docs/RUNBOOK.md`, `docs/LESSONS.md` | guides | design |

Generated files (never edit by hand): `api/openapi.json`, `apple/CapystackKit/.../Endpoints.generated.swift`
(`npm run gen` in `api/`), `web/src/lib/design/tokens.css` and `apple/Capystack/Design/Tokens.generated.swift`
(`node design/build.mjs`), the MCP widgets bundle (`npm run widgets` in `api/`).

## Commands and gates

Every change must pass the gates for the folders it touches before it is called done:

| area | gate |
|---|---|
| api | `cd api && npm ci && npm test && npm run typecheck && npm run gen:check && npm run widgets:check` |
| web | `cd web && npm ci && npm run check && npm test && npm run build` |
| design | `node design/build.mjs --check` |
| init and deploy | `deploy/test-init.sh`, `bash -n` on every shell script, `deploy/app-deploy --help` |
| apple (Mac only) | `cd apple && xcodegen generate`, then `xcodebuild ... build` for iOS Simulator and macOS, and `cd apple/CapystackKit && swift test` |

Other useful commands: `deploy/app-deploy doctor`, `node mockups/shoot.mjs`, `npm run dev` in `web/`.
Run the gates for real; a report that says "passes" without a run is not evidence.

## Add a feature end to end

Example: a "tags" feature on notes.

1. **Contract.** Add the route, shapes and copy to `docs/CONTRACT.md` first.
2. **Migration.** `d1/migrations/NNNN_tags.sql` (append-only; if it syncs, add its trigger rows to `changes`).
3. **Op.** `api/src/registry/ops/tags.ts` with `defineOp({ name, route, auth, input: zod, ai?, mcp?, handler })`.
   Choose `ai.tier` (`free` / `ask` / `hidden`) deliberately: `ask` for anything destructive.
4. **Gen.** `cd api && npm run gen` (rewrites `openapi.json` and the Swift endpoints; `gen:check` fails while stale).
   Add or update the route snapshot knowingly.
5. **Web page.** `web/src/routes/...` using only `web/src/lib/ui/` components and `copy.ts`; mock it first
   (`mockups/`, DESIGN.md) and wait for the owner's OK.
6. **Swift screen.** `apple/Capystack/...` using the Design kit and `Copy.swift`, on `CapystackKit` models and the
   sync layer; `.privacyMask()` on views that draw user content.
7. **MCP tool.** Free-tier ops with `mcp: true` appear in `/mcp` automatically (name = op name, `.` to `_`); add to
   `MCP_SKIPPED_CALLS` to hide chat-only calls; update the widget if it shows this data (`npm run widgets`).
8. **Tests.** Handler test with the real SQL (`node:sqlite`), the op's input rejection, auth, and the client tests.
   Run the gates.

## Rules

- **The op registry is the only way to add an API route.** No ad hoc `app.get`. A route is an op, so it gets validation,
  auth, analytics, chat and MCP for free, and `gen` keeps the clients in sync.
- **Every Anthropic call goes through `ModelRelay`** (`relayFetch`). Direct calls get a 403 from some Cloudflare
  locations (docs/LESSONS.md).
- **Never `.fixedSize()` on a timer `Text` in a Live Activity.**
- **No secrets in git.** Secrets live in `~/.config/<slug>/secrets.json` (chmod 600). Never print them, never paste a key
  into chat or a commit, never add one to a fixture.
- **Production deploys, migrations on the remote database, and App Store uploads need the owner's explicit typed yes
  naming the operation** ("yes, deploy api"). A general "go ahead" is not enough. `deploy/app-deploy` asks for the
  operation by name; do not pass `--yes` on your own. Dry runs are fine.
- **Swift only builds on a Mac.** On Linux, write Swift carefully and report it as "not compiled"; never claim an Apple
  gate passed that was not run on a Mac.
- **Tokens only in UI.** No literal colours, sizes or durations in components; copy lowercase, no emoji, one copy file
  per area.
- **Contract first.** If the code needs something the contract does not say, change `docs/CONTRACT.md` and tell the
  owner, then the code. Do not invent names.
- **Append-only migrations, small files, boring code, match the style of the neighbouring files.**
- **Do not commit or push unless the owner asked.**

## Pointers

- `docs/CONTRACT.md`: names, routes, auth, sync, AI, MCP, push, schema, kit, gates.
- `DESIGN.md`: principles, voice, layout, motion, kit, mockup-first workflow, re-skin.
- `docs/RUNBOOK.md`: first-time setup, secrets, deploy order, MCP setup lines.
- `docs/LESSONS.md`: runtime lessons as problem and rule. Read before touching Workers, DOs, MCP, push or Release builds.
- `README.md`: the short tour.
