import { clearToken, getToken, mintToken } from "./api";

// "in": a token is cached (or just minted); "out": no token or the Access session ended; "unknown": not looked yet.
export const auth = $state<{ state: "unknown" | "in" | "out"; busy: boolean; failed: boolean }>({ state: "unknown", busy: false, failed: false });

export function initAuth() {
	auth.state = getToken() ? "in" : "unknown";
	if (auth.state === "unknown") void signIn();
}

export async function signIn() {
	auth.busy = true;
	auth.failed = false;
	try {
		await mintToken();
		auth.state = "in";
	} catch {
		auth.state = "out";
		auth.failed = true;
	} finally {
		auth.busy = false;
	}
}

export function markSignedOut() {
	clearToken();
	auth.state = "out";
}
