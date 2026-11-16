# capystack

A template for a private, single-owner app that runs on a SvelteKit web app and native SwiftUI apps (iPhone, iPad, Mac)
over one Cloudflare backend. Clone it, run `./init`, deploy. It ships a small notes app as the demo feature, so every
layer is wired end to end: sign-in, sync, chat AI, MCP, push, Live Activities, analytics.

## What you get

- **API Worker** on Cloudflare: every route is an op (`defineOp`) that is also a chat tool and an MCP tool, with generated
  OpenAPI and Swift endpoints. D1 database, Durable Objects (`ModelRelay` for Anthropic, `JobRunner` for jobs), cron.
- **Web app** (SvelteKit, Svelte 5) behind Cloudflare Access (email one-time PIN, owner only), with a keys-for-tools page.
- **Apple apps**: one SwiftUI target for iPhone, iPad and Mac, `CapystackKit` package (models, API client, offline-first
  sync), a widgets extension with a Live Activity, TestFlight scripts.
- **MCP server** at `/mcp` so Claude, ChatGPT and others can use your app, with a widget.
- **Design system**: `design/tokens.json` generates CSS and Swift tokens; a component kit on both sides; HTML mockups.
- **Deploy tooling**: `deploy/app-deploy` (api, web, migrate, TestFlight, doctor) with typed confirmation.
- **Agent guides**: `AGENTS.md`, `CLAUDE.md`, `DESIGN.md`, and the hard-won `docs/LESSONS.md`.

## Quick start

    ./init my-app --web-host app.example.com --api-host app-api.example.com --bundle-prefix com.example
    # then follow docs/RUNBOOK.md: D1, Access, secrets file
    deploy/app-deploy doctor
    deploy/app-deploy migrate && deploy/app-deploy api && deploy/app-deploy web

`./init --help` lists the options; `deploy/test-init.sh` shows it working on a throwaway copy. Apple apps need a Mac
(`cd apple && xcodegen generate`, then build in Xcode or `xcodebuild`).

## Develop

    cd api && npm ci && npm test && npm run typecheck && npm run gen:check && npm run widgets:check
    cd web && npm ci && npm run check && npm test && npm run build
    node design/build.mjs --check

Mock UI first (`mockups/`, `node mockups/shoot.mjs`), build second.

## Docs

| file | for |
|---|---|
| [AGENTS.md](AGENTS.md) | any coding agent: stack, repo map, gates, rules, adding a feature |
| [CLAUDE.md](CLAUDE.md) | Claude-specific: delegation, production, Mac builds |
| [DESIGN.md](DESIGN.md) | product design and style guide, re-skinning |
| [docs/CONTRACT.md](docs/CONTRACT.md) | the binding spec |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | first-time setup, secrets, deploy order, MCP setup |
| [docs/LESSONS.md](docs/LESSONS.md) | runtime lessons, problem then rule |
| [mockups/README.md](mockups/README.md) | the mockup workflow |
| [deploy/apple/README.md](deploy/apple/README.md) | TestFlight and Mac install |
