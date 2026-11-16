// localStorage with a try/catch (private mode, quota, SSR/prerender). Everything the app caches lives under one prefix.
const P = "capystack.";

export const store = {
	get<T>(key: string, fallback: T): T {
		if (typeof localStorage === "undefined") return fallback;
		try {
			const raw = localStorage.getItem(P + key);
			return raw === null ? fallback : (JSON.parse(raw) as T);
		} catch {
			return fallback;
		}
	},
	set(key: string, value: unknown) {
		if (typeof localStorage === "undefined") return;
		try {
			localStorage.setItem(P + key, JSON.stringify(value));
		} catch {
			/* quota or private mode: the cache is an optimisation, never required */
		}
	},
	remove(key: string) {
		if (typeof localStorage === "undefined") return;
		try {
			localStorage.removeItem(P + key);
		} catch {
			/* ignore */
		}
	},
	clear() {
		if (typeof localStorage === "undefined") return;
		try {
			for (const k of Object.keys(localStorage)) if (k.startsWith(P)) localStorage.removeItem(k);
		} catch {
			/* ignore */
		}
	},
};
