// /api/auth/app and /api/auth/web against the real SQL on node:sqlite (the migrations in d1/migrations).
import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lookupToken } from "../../api/src/keys";
import { APP_CALLBACK, HANDOFF_TTL_MS, handleAuth } from "../src/lib/server/auth";
import type { Env } from "../src/lib/server/env";
import { hashToken } from "../src/lib/server/http";
import { MAX_SESSIONS, SESSION_TTL_MS } from "../src/lib/server/sessions";
import { createFakeD1, goodClaims, makeEnv, makeJwksFetch, makeSigner, newCache, NOW, OWNER, WEB_ORIGIN, type FakeD1, type Signer } from "./support";

const VERIFIER = "dBjftJeZ4CVP-mJ92K9q-r6SmQ8z3-e0UhMcbuqJw0k";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15";

let signer: Signer;
let token: string;
beforeAll(async () => {
	signer = await makeSigner();
	token = await signer.sign(goodClaims());
});

let db: FakeD1;
let clock: number;
let env: Env;
beforeEach(() => {
	db = createFakeD1();
	clock = NOW;
	env = makeEnv(db);
});

const deps = () => ({ jwks: newCache(makeJwksFetch(() => [signer]).fetchFn), now: () => clock });

type Opts = { token?: string | null; origin?: string | null; body?: string; ua?: string };
const call = (method: string, path: string, o: Opts = {}) => {
	const headers = new Headers();
	const t = o.token === undefined ? token : o.token;
	if (t) headers.set("Cf-Access-Jwt-Assertion", t);
	if (o.origin !== null && method !== "GET") headers.set("Origin", o.origin ?? WEB_ORIGIN);
	if (o.body !== undefined) headers.set("content-type", "application/json");
	if (o.ua) headers.set("User-Agent", o.ua);
	return handleAuth(new Request(`${WEB_ORIGIN}${path}`, { method, headers, body: o.body, redirect: "manual" }), env, deps());
};
const appUrl = (q: Record<string, string>) => `/api/auth/app?${new URLSearchParams(q)}`;
const goodQuery = { platform: "ios", device: "harmony's iphone", challenge: CHALLENGE };
const handoffs = () => db.raw.prepare("SELECT * FROM auth_handoffs").all() as Record<string, any>[];
const sessions = () => db.raw.prepare("SELECT * FROM api_keys WHERE kind = 'session'").all() as Record<string, any>[];

describe("GET /api/auth/app", () => {
	it("without a valid Access JWT: 401 page, D1 untouched", async () => {
		db.breakIt();
		for (const t of [null, await signer.sign(goodClaims({ email: "someone@else.com" }))]) {
			const r = await call("GET", appUrl(goodQuery), { token: t });
			expect(r.status).toBe(401);
			expect(r.headers.get("location")).toBeNull();
			expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
		}
	});
	it("stores a one-time code (hash only, 2 minutes) and answers 302 to the fixed app callback", async () => {
		const r = await call("GET", appUrl(goodQuery));
		expect(r.status).toBe(302);
		expect(r.headers.get("cache-control")).toBe("no-store");
		const loc = r.headers.get("location")!;
		expect(APP_CALLBACK).toBe("capystack://signed-in");
		const code = new URL(loc).searchParams.get("code")!;
		expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(loc).toBe(`capystack://signed-in?code=${code}`);
		expect(handoffs()).toEqual([
			{
				code_hash: createHash("sha256").update(code).digest("hex"),
				challenge: CHALLENGE,
				platform: "ios",
				device: "harmony's iphone",
				expires_at: NOW + HANDOFF_TTL_MS,
			},
		]);
		expect(HANDOFF_TTL_MS).toBe(120_000);
		expect(JSON.stringify(handoffs())).not.toContain(code);
	});
	it("every code is fresh", async () => {
		const a = (await call("GET", appUrl(goodQuery))).headers.get("location");
		const b = (await call("GET", appUrl(goodQuery))).headers.get("location");
		expect(a).not.toBe(b);
		expect(handoffs()).toHaveLength(2);
	});
	it("the redirect target never comes from the request", async () => {
		const r = await call("GET", appUrl({ ...goodQuery, redirect_uri: "https://evil.example/", callback: "evil://x", scheme: "evil" }));
		expect(r.status).toBe(302);
		expect(r.headers.get("location")!.startsWith("capystack://signed-in?code=")).toBe(true);
	});
	it("accepts ios, ipados and mac; trims the device name", async () => {
		for (const platform of ["ios", "ipados", "mac"]) expect((await call("GET", appUrl({ ...goodQuery, platform, device: `  ${platform} one ` }))).status).toBe(302);
		expect(handoffs().map((h) => [h.platform, h.device])).toEqual([
			["ios", "ios one"],
			["ipados", "ipados one"],
			["mac", "mac one"],
		]);
	});
	it("a bad query is a plain 400 page that echoes nothing and stores nothing", async () => {
		const bad: Record<string, string>[] = [
			{},
			{ ...goodQuery, platform: "web" },
			{ ...goodQuery, platform: "android" },
			{ ...goodQuery, platform: "" },
			{ ...goodQuery, device: "" },
			{ ...goodQuery, device: "   " },
			{ ...goodQuery, device: "x".repeat(41) },
			{ ...goodQuery, device: "<script>alert(1)</script>\nx" },
			{ ...goodQuery, challenge: CHALLENGE.slice(1) },
			{ ...goodQuery, challenge: CHALLENGE + "A" },
			{ ...goodQuery, challenge: CHALLENGE.slice(1) + "=" },
			{ platform: "ios", device: "x" },
		];
		for (const q of bad) {
			const r = await call("GET", appUrl(q));
			expect(r.status, JSON.stringify(q)).toBe(400);
			expect(r.headers.get("location")).toBeNull();
			expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
			const text = await r.text();
			expect(text).not.toContain("<script>alert");
			expect(text).not.toContain(CHALLENGE);
		}
		expect(handoffs()).toEqual([]);
	});
	it("only GET", async () => {
		expect((await call("POST", appUrl(goodQuery))).status).toBe(405);
		expect(handoffs()).toEqual([]);
	});
	it("drops handoffs that have expired", async () => {
		await call("GET", appUrl(goodQuery));
		clock += HANDOFF_TTL_MS + 1;
		await call("GET", appUrl(goodQuery));
		expect(handoffs().map((h) => h.expires_at)).toEqual([clock + HANDOFF_TTL_MS]);
	});
	it("a D1 failure is a 500 page, never a redirect", async () => {
		const broken = { ...env, DB: { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("down"); } }) }) } as unknown as D1Database };
		const r = await handleAuth(new Request(`${WEB_ORIGIN}${appUrl(goodQuery)}`, { headers: { "Cf-Access-Jwt-Assertion": token } }), broken, deps());
		expect(r.status).toBe(500);
		expect(r.headers.get("location")).toBeNull();
	});
});

describe("POST /api/auth/web", () => {
	it("without a valid Access JWT: 401 auth.required, D1 untouched", async () => {
		db.breakIt();
		const r = await call("POST", "/api/auth/web", { token: null });
		expect(r.status).toBe(401);
		expect(await r.json()).toEqual({ error: "auth.required" });
	});
	it("Origin must be exactly the web origin", async () => {
		for (const origin of ["https://evil.example", null, WEB_ORIGIN + "/"]) {
			const r = await call("POST", "/api/auth/web", { origin });
			expect(r.status).toBe(403);
		}
		expect(sessions()).toEqual([]);
	});
	it("a WEB_ORIGIN left unset falls back to the request's own origin", async () => {
		delete env.WEB_ORIGIN;
		expect((await call("POST", "/api/auth/web")).status).toBe(200);
		expect((await call("POST", "/api/auth/web", { origin: "https://evil.example" })).status).toBe(403);
	});
	it("mints a web session: device from the User-Agent, only the hash stored, the token passes the API's lookup", async () => {
		const r = await call("POST", "/api/auth/web", { ua: SAFARI_MAC });
		expect(r.status).toBe(200);
		expect(r.headers.get("cache-control")).toBe("no-store");
		expect([...r.headers.keys()].filter((h) => h.startsWith("access-control-"))).toEqual([]);
		const b = (await r.json()) as any;
		expect(Object.keys(b).sort()).toEqual(["session", "token"]);
		expect(b.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(b.session).toEqual({
			id: expect.stringMatching(/^[0-9a-f-]{36}$/),
			kind: "session",
			name: "safari on mac",
			device: "safari on mac",
			platform: "web",
			created_at: NOW,
			last_used_at: NOW,
			expires_at: NOW + SESSION_TTL_MS,
		});
		const [row] = sessions();
		expect(row).toMatchObject({ id: b.session.id, name: "safari on mac", token_hash: await hashToken(b.token), platform: "web", kind: "session" });
		expect(JSON.stringify(sessions())).not.toContain(b.token);
		expect((await lookupToken(db, b.token, NOW + 1))?.id).toBe(b.session.id);
	});
	it("an empty body is fine; a bad body is 400", async () => {
		expect((await call("POST", "/api/auth/web", { body: "" })).status).toBe(200);
		expect((await call("POST", "/api/auth/web", { body: "{}" })).status).toBe(200);
		for (const body of ["{nope", "[]", '"x"', '{"replace":5}', JSON.stringify({ replace: "x".repeat(2000) })]) {
			expect((await call("POST", "/api/auth/web", { body })).status, body).toBe(400);
		}
	});
	it("replace: the browser's old session is revoked", async () => {
		const old = (await (await call("POST", "/api/auth/web")).json()) as any;
		const r = await call("POST", "/api/auth/web", { body: JSON.stringify({ replace: old.token }) });
		expect(r.status).toBe(200);
		const fresh = (await r.json()) as any;
		expect(await lookupToken(db, old.token, NOW + 1)).toBeNull();
		expect((await lookupToken(db, fresh.token, NOW + 1))?.id).toBe(fresh.session.id);
	});
	it("replace never revokes a key", async () => {
		const KEY = "k".repeat(43);
		db.raw.prepare("INSERT INTO api_keys (id, kind, name, token_hash, created_at) VALUES (?, 'key', ?, ?, ?)").run("key-1", "tool", await hashToken(KEY), 1);
		expect((await call("POST", "/api/auth/web", { body: JSON.stringify({ replace: KEY }) })).status).toBe(200);
		expect((await lookupToken(db, KEY, NOW + 1))?.id).toBe("key-1");
	});
	it(`at most ${MAX_SESSIONS} active sessions: the least recently used goes`, async () => {
		const tokens: string[] = [];
		for (let i = 0; i < MAX_SESSIONS + 1; i++) {
			clock += 10;
			tokens.push(((await (await call("POST", "/api/auth/web")).json()) as any).token);
		}
		expect(db.raw.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE kind = 'session' AND revoked_at IS NULL").get()).toEqual({ n: MAX_SESSIONS });
		expect(await lookupToken(db, tokens[0]!, clock)).toBeNull();
		expect(await lookupToken(db, tokens[1]!, clock)).not.toBeNull();
	});
	it("only POST", async () => {
		expect((await call("GET", "/api/auth/web")).status).toBe(405);
	});
});

describe("routing", () => {
	it("unknown /api/auth paths are 404 after auth", async () => {
		expect((await call("GET", "/api/auth")).status).toBe(404);
		expect((await call("GET", "/api/auth/other")).status).toBe(404);
		expect((await call("GET", "/api/auth/other", { token: null })).status).toBe(401);
	});
});
