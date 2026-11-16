// PostHog, loaded only when the Worker reports a token (POSTHOG_TOKEN). Nothing here runs without one, and the
// posthog-js bundle is never in the first-load JS: it is a dynamic import after the page is idle.
let started = false;

export function startAnalytics() {
	if (started || typeof window === "undefined") return;
	started = true;
	const run = async () => {
		try {
			const res = await fetch("/api/config", { credentials: "same-origin" });
			if (!res.ok) return;
			const cfg = (await res.json()) as { posthog: { host: string; token: string } | null };
			if (!cfg.posthog?.token) return;
			// A separate chunk: fetched only now, only with a token.
			const { default: posthog } = await import("posthog-js");
			posthog.init(cfg.posthog.token, {
				api_host: cfg.posthog.host,
				person_profiles: "identified_only",
				capture_pageview: true,
				disable_session_recording: true, // notes are private text
			});
		} catch {
			/* analytics never breaks the app */
		}
	};
	const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
	if (idle) idle(run);
	else setTimeout(run, 2000);
}
