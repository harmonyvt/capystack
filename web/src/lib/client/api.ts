// The API client. The browser talks to the API host directly with `Authorization: Bearer <token>`; the token is a
// device session minted by the web Worker (POST /api/auth/web, same origin, Access cookie), kept in localStorage and
// re-minted once on a 401 (contract section 3).
import { store } from "./storage";

export const API_URL: string = __API_URL__;

export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message?: string,
	) {
		super(message ?? code);
	}
	get isAuth() {
		return this.code === "auth.required";
	}
	get isNetwork() {
		return this.status === 0;
	}
}

const TOKEN_KEY = "token";
export const getToken = (): string | null => store.get<string | null>(TOKEN_KEY, null);
export const clearToken = () => store.remove(TOKEN_KEY);

export type SessionInfo = {
	id: string;
	kind: "session" | "key";
	name: string;
	device: string | null;
	platform: string | null;
	created_at: number;
	last_used_at: number | null;
	expires_at: number | null;
};

let minting: Promise<string> | null = null;

// A new session for this browser. One flight at a time; the old token (if any) is retired by the Worker.
export function mintToken(): Promise<string> {
	minting ??= (async () => {
		const old = getToken();
		let res: Response;
		try {
			res = await fetch("/api/auth/web", {
				method: "POST",
				credentials: "same-origin",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(old ? { replace: old } : {}),
			});
		} catch {
			throw new ApiError(0, "network");
		}
		// An expired Access session answers with a redirect to the login page (or HTML): not our JSON.
		const type = res.headers.get("content-type") ?? "";
		if (!res.ok || !type.includes("application/json") || res.redirected) throw new ApiError(res.status || 401, "auth.required");
		const body = (await res.json()) as { token: string };
		store.set(TOKEN_KEY, body.token);
		return body.token;
	})().finally(() => (minting = null));
	return minting;
}

type Init = { method?: string; body?: unknown; idempotencyKey?: string; signal?: AbortSignal };

async function send(path: string, init: Init, token: string): Promise<Response> {
	const headers: Record<string, string> = { authorization: `Bearer ${token}` };
	if (init.body !== undefined) headers["content-type"] = "application/json";
	if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
	try {
		return await fetch(API_URL + path, {
			method: init.method ?? "GET",
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: init.signal,
		});
	} catch {
		throw new ApiError(0, "network");
	}
}

async function parse<T>(res: Response): Promise<T> {
	if (res.status === 204) return undefined as T;
	let body: unknown = null;
	try {
		body = await res.json();
	} catch {
		/* not JSON */
	}
	if (!res.ok) {
		const b = (body ?? {}) as { error?: string; message?: string };
		throw new ApiError(res.status, b.error ?? `http.${res.status}`, b.message);
	}
	return body as T;
}

export async function api<T = unknown>(path: string, init: Init = {}): Promise<T> {
	let token = getToken() ?? (await mintToken());
	let res = await send(path, init, token);
	if (res.status === 401) {
		token = await mintToken(); // one re-mint, then give up
		res = await send(path, init, token);
	}
	return parse<T>(res);
}

// Same-origin calls to the web Worker (keys for tools). Access cookie authenticates; no Bearer.
export async function web<T = unknown>(path: string, init: Init = {}): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, {
			method: init.method ?? "GET",
			credentials: "same-origin",
			headers: init.body === undefined ? {} : { "content-type": "application/json" },
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		});
	} catch {
		throw new ApiError(0, "network");
	}
	return parse<T>(res);
}
