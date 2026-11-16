# LESSONS.md

Hard-won rules from running this stack for real (the cobalt/capystore deployment it was distilled from). Each one is a
problem we hit live, then the rule that stops it happening again. Read it before touching Workers, Durable Objects,
containers, MCP, push or the Release build.

## Workers runtime

**`pipeTo()` between streams is not implemented in the Workers runtime.**
Rule: copy streams with a reader/writer loop (`reader.read()` then `writer.write()`), and close the writer yourself.

**`AbortSignal.timeout()` is not honoured on `containerFetch` (or fetches made inside a Durable Object).**
The call just hangs past the timeout.
Rule: race your own timer against the call (`Promise.race([call, timeout])`) and abandon the loser. Never rely on a
signal to stop a call inside a DO.

**Work after a Durable Object returns its response does not survive.** The isolate can be evicted the moment the
response is sent, so a "finish this in the background" promise silently dies.
Rule: make background work poll-driven. Store the state, return, and let `alarm()` (or the caller's next poll) advance
it. `JobRunner` steps from `alarm()` every 2 s for exactly this reason. `ctx.waitUntil` is fine for short side effects
in a Worker (analytics), not for real work in a DO.

**A container rollout restarts instances with their old env.** After a deploy, a running container keeps the secrets and
vars it started with, so a rotated key makes the Worker and container disagree.
Rule: fingerprint the env (and the deploy id) and restart the container when the fingerprint changes (cobalt's
`CobaltContainer`). When rotating an internal key, redeploy and let the instance sleep, or restart it.

**Sequential D1 calls from a far edge cost about 190 ms each.** A route with 11 statements took 2.2 s p50 from
Singapore against 0.13 s from the database's region.
Rule: set `placement: { region }` on the API Worker next to D1 (`placementRegion` in app.config.json), and batch
statements (`db.batch([...])`) so a route is one round trip. Crons and Durable Objects are not moved by placement.

**A secret declared in the config but missing from the secrets file makes `cf deploy` refuse.**
Rule: every declared `bindings.secret()` key must exist in the secrets file, with an empty string when the feature is
off. The code treats empty as "feature off" and says so in `/capabilities`. `app-deploy doctor` checks the keys.

**Use the global `cf` for D1 migrations.** The project-pinned copy (`npx cf`) failed remote applies with
`[7403] account is not valid or is not authorized`.
Rule: `cf` installed globally for `d1 migrations`; `deploy/app-deploy migrate` does this. Never edit an applied
migration; add a new numbered file.

**Never `wrangler login` or `wrangler deploy`.** `cf` delegates the build to the local Wrangler devDependency.
Rule: deploys go through `deploy/app-deploy`; Wrangler stays a bundler.

## AI

**Anthropic answers 403 "Request not allowed" from some Cloudflare locations** (Hong Kong, Singapore egress).
Rule: every Anthropic call goes through the `ModelRelay` Durable Object pinned to `enam` (`relayFetch`). No direct
`fetch("https://api.anthropic.com")`, no SDK instance without the relay fetch. This is a repo rule, not a preference.

**Model output is not an API.**
Rule: validate tool inputs with the op's zod schema before running them, cap the tool-use loop (8 turns), and store the
model's text, never trust it for control flow.

## MCP

**Claude desktop and claude.ai cache `tools/list`.** Renaming or removing a tool does not show up until the user
reconnects or removes and re-adds the connector; saved prompts and permission allowlists naming the old tool names break.
Rule: treat tool names as a public API. Rename by adding the new name and keeping the old one answering (a retired
alias that is no longer listed) for raw JSON-RPC clients, and tell the owner to reconnect. Change tools deliberately,
not casually.

**Hosts only call tools they listed.** Aliases for retired tools help scripts, not Claude.
Rule: after a tool change, refresh the connector in each host (ChatGPT: Refresh on the connection page) and run the
prompt set in docs/RUNBOOK.md.

**Widgets are one bundle.**
Rule: after editing anything under `api/src/mcp/widgets/`, run `npm run widgets`; `npm run widgets:check` is a gate.

## Auth and keys

**Cloudflare Access cannot sit in front of the API.** The web app's cross-origin fetches carry no cookies, so Access
would block every call.
Rule: Access guards the web host only; the API's lock is per-owner Bearer keys (hashed in D1). The web Worker verifies
the Access JWT itself for `/api/auth/*` and `/api/keys*`.

**Store only hashes of tokens.**
Rule: `sha256` hex in D1, shown once at creation; cache lookups 60 s per isolate; sessions are 90-day sliding, at most 50.

**CORS defaults are dangerous.**
Rule: the API allows exactly the web origin (never a wildcard), and answers preflights itself.

## Push and Live Activities

**`.fixedSize()` on a timer `Text` in a Live Activity breaks the layout** (the text stops updating its width, clips or
jumps in the island and lock screen).
Rule: never `.fixedSize()` on a `Text(timerInterval:)` or any live-updating text in an activity; give it a fixed frame
or `.monospacedDigit()` with `.frame(maxWidth:)` instead.

**One device island routing: the iPad stole an island.** Server-started activities (`push-to-start`) went to whichever
device registered last.
Rule: the newest `live_start` token on platform `ios` gets server-started islands, else any. One device per start.

**Live Activity pushes with empty APNs secrets silently do nothing**, and the island freezes in the background.
Rule: `/capabilities.features.push` is false unless all three APNs secrets are set; `app-deploy` warns before an API
deploy when any is empty.

**TestFlight reads as the production APNs environment** (no `embedded.mobileprovision`).
Rule: register tokens with `env: "sandbox" | "production"` from the build, and send to the matching APNs host.

## Apple builds

**DEBUG-only state breaks Release archives.** A launch switch or store path that only exists under `#if DEBUG` compiled
fine in Debug, then the Release archive behaved differently (or shipped the switch).
Rule: no behaviour behind `#if DEBUG` that Release depends on. Debug-only launch switches carry `DebugOnly` in their
name (`<Swift>DebugOnly...`); `testflight.sh` and `mac-install.sh` refuse to ship a binary containing it.

**Swift only builds on a Mac.** A Linux agent cannot run `xcodebuild` or `swift test` for the apps.
Rule: lanes on Linux write Swift carefully and say "not compiled" in their report; a Mac session (Remote Control)
runs the Apple gates before anything is called done.

**Worktrees break git-derived version info.** In a git worktree `.git` is a file, which breaks tools that read
`.git/HEAD` directly.
Rule: build from the main checkout or give the tool a synthetic git dir; `app-deploy ... --commit <ref>` uses a
temporary worktree on purpose and only for Apple archives (which do not read `.git`).

**Build numbers must keep rising across channels.**
Rule: `testflight.sh` takes one past the newest number in its log and `project.yml`; pass `--build` only to override.

## Tests and process

**Flaky timing tests.** Tests that race real clocks or `setTimeout` pass locally and fail in CI.
Rule: inject the clock (a `now()` parameter), drive alarms by calling the handler, never `sleep` in a test. A test that
needs a retry to pass is a bug.

**Reports lie; files and runs do not.**
Rule: a lane's "done" is checked against the files and a real run of the gates (`AGENTS.md`, Gates) before anything is
called finished.

**Route changes must be deliberate.**
Rule: `route-snapshot.test.ts` pins every route's answer; a PR that moves routes must say why and update the snapshot
knowingly. `npm run gen` rewrites `openapi.json` and the Swift endpoints; `gen:check` fails while they are stale.

**Secrets leak through logs and chat.**
Rule: never print the secrets file, a key, or a `.p8`; scripts print key ids only. The secrets file is `chmod 600` and
outside the repo.
