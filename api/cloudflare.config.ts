// The API Worker's deploy config for the Cloudflare `cf` CLI (as cobalt's deploy/cloudflare/api/cloudflare.config.ts).
// `npm run deploy` / `npm run dry-run` run `cf deploy --secrets-file ~/.config/capystack/secrets.json`. cf hands the
// bundling to the local Wrangler devDependency (wrangler.config.ts); never `wrangler deploy` this.
//
// Every value that names this app comes from app.config.json and is rewritten by ./init: keep them spelled exactly as
// they are here.
import { bindings, defineConfig, exports, triggers } from "cf/config";

export default defineConfig({
	worker: {
		name: "capystack-api",
		compatibilityDate: "2026-09-01",
		entrypoint: "src/index.ts",
		workersDev: false,
		previewUrls: false,
		// Worker and Durable Object console lines and exceptions to Workers Logs
		// (`cf observability telemetry query`).
		observability: { enabled: true, logs: { enabled: true, invocationLogs: true } },
		// Run the fetch handler next to D1, not next to the caller. Every route makes a few D1 statements one after
		// another, and from a far edge each is a full round trip (cobalt measured ~190 ms each from Singapore and Hong
		// Kong to a database in Oceania: 2.2 s for an 11-statement route against 0.13 s next to it). An explicit region
		// rather than smart placement: smart placement learns from traffic, and a one-owner app has too little for it to
		// learn anything. Set it to the region of your D1 database (`cf workers placement regions list`). Placement moves
		// the fetch handler only; the cron and the Durable Objects stay where they are. The `cf-placement` response header
		// says where a request ran.
		placement: { region: "aws:ap-southeast-2" },
		// One subdomain level, so the zone's Universal SSL certificate covers it.
		domains: ["capystack-api.capybaraharmony.com"],
		// Every 15 minutes: housekeeping (src/cron.ts): old delete markers, idempotency rows, sign-in codes, jobs,
		// dead sessions and their push tokens.
		triggers: [triggers.scheduled({ schedule: "*/15 * * * *" })],
		env: {
			// The whole schema: ../d1/migrations. Shared with the web Worker (it writes sign-in codes, sessions and keys).
			// The id comes from app.config.json (`cf d1 create capystack` prints it).
			DB: bindings.d1({
				name: "capystack",
				id: "00000000-0000-0000-0000-000000000000",
			}),
			// Every Anthropic call goes through this Durable Object, pinned to North America (src/model-fetch.ts): from
			// some Cloudflare locations (Hong Kong and Singapore seen live) Anthropic answers 403 "Request not allowed".
			MODEL_RELAY: bindings.durableObject({ worker: "capystack-api", exportName: "ModelRelay" }),
			// One object per demo job: progress and Live Activity pushes, stepped from alarm() because work after a
			// Durable Object's response does not survive (src/jobs.ts).
			JOB_RUNNER: bindings.durableObject({ worker: "capystack-api", exportName: "JobRunner" }),
			// SECRETS, from the secrets file through --secrets-file (cf refuses to deploy while a declared one is missing
			// from the file; an empty string is fine and switches the feature off).
			//   ANTHROPIC_API_KEY: chat and notes.summarize. Empty: features.ai false, those routes answer 503 ai.off.
			ANTHROPIC_API_KEY: bindings.secret(),
			//   APNS_KEY_P8 (the .p8 file's PEM as one JSON string with \n escapes), APNS_KEY_ID, APNS_TEAM_ID: push and
			//   Live Activities. Any of them empty: features.push false and nothing is sent.
			APNS_KEY_P8: bindings.secret(),
			APNS_KEY_ID: bindings.secret(),
			APNS_TEAM_ID: bindings.secret(),
			// The chat's and the summary's model.
			CHAT_MODEL: bindings.text("claude-haiku-5-5"),
			// The web app's origin: the only origin that gets CORS headers (and whose preflights are answered).
			CORS_URL: bindings.text("https://capystack.capybaraharmony.com"),
			// PostHog (src/posthog.ts). The project token is write-only and safe to ship (the apps get it from GET
			// /capabilities). Empty: no events anywhere.
			POSTHOG_HOST: bindings.text("https://us.i.posthog.com"),
			POSTHOG_TOKEN: bindings.text(""),
			// The APNs topic (Live Activities: <bundle id>.push-type.liveactivity).
			APNS_BUNDLE_ID: bindings.text("com.capybaraharmony.capystack"),
			// "auto": each token's own env as the app registered it (a debug build says sandbox, TestFlight and the App
			// Store production). "sandbox" or "production" force one host for every token.
			APNS_ENV: bindings.text("auto"),
		},
		exports: {
			ModelRelay: exports.durableObject({ storage: "sqlite" }),
			JobRunner: exports.durableObject({ storage: "sqlite" }),
		},
	},
	// No container by default. To add the optional helper (../containers/helper/README.md): defineContainer, a
	// durableObject export with `container`, a binding, and list it here.
	containers: [],
});
