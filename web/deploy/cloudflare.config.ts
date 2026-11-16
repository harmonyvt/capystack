import { bindings, defineConfig } from "cf/config";
import app from "../../app.config.json" with { type: "json" };

// The web Worker `capystack-web` (SvelteKit via @sveltejs/adapter-cloudflare). Deploy: `npm run deploy` (build, then
// `cf deploy`, no secrets file: this Worker declares no secrets and cf would upload every key in it), `npm run dry-run` builds everything and uploads nothing. Never `wrangler deploy`:
// cf delegates the bundle to the local Wrangler (see wrangler.config.ts) and does the rest itself.
//
// Identity (names, hosts, Access settings, D1 id, region) comes from ../app.config.json, the one file `./init` edits.
export default defineConfig({
	worker: {
		name: `${app.name}-web`,
		compatibilityDate: "2026-09-01",
		// The adapter's output (`npm run build`): the SvelteKit server wrapped in a Worker. Static files (prerendered
		// pages, /_app/immutable/*) are served by the platform from the assets directory (wrangler.config.ts) before
		// this code runs, so a page view costs no Worker invocation; only /api/* wakes it.
		entrypoint: "../.svelte-kit/worker/_worker.js",
		workersDev: false,
		observability: { enabled: true, logs: { enabled: true, invocationLogs: true } },
		previewUrls: false,
		assets: {
			notFoundHandling: "404-page",
		},
		// Run the fetch handler next to D1, not next to the caller: every route makes several statements one after
		// another and each costs a round trip from a far edge (about 190 ms from Asia to Oceania; cobalt measured
		// 2.2 s against 0.13 s). The explicit region (`cf workers placement regions list` names them all), not
		// "smart": smart placement decides from observed traffic and has little to learn from one owner's use.
		placement: { region: app.placementRegion },
		domains: [app.webHost],
		env: {
			// Static assets (the adapter's `read()` fetches prerendered files through this binding).
			ASSETS: bindings.assets(),
			// The shared database: this Worker writes sessions, handoffs and keys; the API Worker reads them.
			// Schema: ../d1/migrations. Apply with the global `cf d1 migrations apply <id> --dir ../d1/migrations`.
			DB: bindings.d1({ name: app.d1Name, id: app.d1Id }),
			// Service binding to the API Worker (deploy the API first: this binding needs it to exist).
			API: bindings.worker({ worker: `${app.name}-api` }),
			// Cloudflare Access (Zero Trust) application protecting this hostname.
			ACCESS_TEAM_DOMAIN: bindings.text(app.accessTeamDomain),
			ACCESS_AUD: bindings.text(app.accessAud),
			OWNER_EMAIL: bindings.text(app.ownerEmail),
			// The only Origin allowed to create or revoke keys and sessions (CSRF).
			WEB_ORIGIN: bindings.text(`https://${app.webHost}`),
			API_URL: bindings.text(`https://${app.apiHost}`),
			// Public-safe analytics settings; an empty token keeps PostHog off (and posthog-js is never fetched).
			POSTHOG_HOST: bindings.text(app.posthogHost),
			POSTHOG_TOKEN: bindings.text(app.posthogToken),
		},
	},
});
