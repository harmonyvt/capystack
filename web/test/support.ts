import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { JwksCache, type AccessConfig } from "../src/lib/server/access";
import type { Env } from "../src/lib/server/env";

export const TEAM = "example.cloudflareaccess.com";
export const AUD = "9afe49f50618965d109d9205999018b35bf49ec1847cd6465afb6330fc009b66";
export const OWNER = "owner@example.com";
export const WEB_ORIGIN = "https://capystack.capybaraharmony.com";
export const NOW = 1_800_000_000_000; // ms
export const NOW_S = NOW / 1000;

export const cfg: AccessConfig = { teamDomain: TEAM, aud: AUD, ownerEmail: OWNER };

// ---- a D1Database look-alike on node:sqlite, over the real migrations --------------------------------------------
// The api lane owns d1/migrations; every *.sql in it runs in file-name order. If the directory has none (a checkout
// without the api lane), the two tables the web Worker touches are created from FIXTURE_SQL, which mirrors contract
// section 10.
const MIGRATIONS = fileURLToPath(new URL("../../d1/migrations/", import.meta.url));
const FIXTURE_SQL = `
CREATE TABLE api_keys (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('session', 'key')), name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE, device TEXT, platform TEXT, created_at INTEGER NOT NULL,
    last_used_at INTEGER, expires_at INTEGER, revoked_at INTEGER
);
CREATE TABLE auth_handoffs (
    code_hash TEXT PRIMARY KEY, challenge TEXT NOT NULL, platform TEXT NOT NULL, device TEXT NOT NULL, expires_at INTEGER NOT NULL
);`;

export function schemaSql(): { sql: string; source: "migrations" | "fixture" } {
	let files: string[] = [];
	try {
		files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
	} catch {
		/* no directory */
	}
	if (!files.length) return { sql: FIXTURE_SQL, source: "fixture" };
	return { sql: files.map((f) => readFileSync(MIGRATIONS + f, "utf8")).join("\n"), source: "migrations" };
}

export type FakeD1 = D1Database & { raw: DatabaseSync; breakIt(): void };

export function createFakeD1(sql: string = schemaSql().sql): FakeD1 {
	const raw = new DatabaseSync(":memory:");
	raw.exec(sql);
	let broken = false;
	const statement = (text: string, params: SQLInputValue[] = []) => {
		const guard = () => {
			if (broken) throw new Error("D1_ERROR: simulated outage");
		};
		return {
			bind: (...p: SQLInputValue[]) => statement(text, p),
			async run() {
				guard();
				const r = raw.prepare(text).run(...params);
				return { success: true, results: [], meta: { changes: Number(r.changes) } };
			},
			async all() {
				guard();
				const rows = raw.prepare(text).all(...params).map((r) => ({ ...r }));
				return { success: true, results: rows, meta: { changes: rows.length } };
			},
			async first(col?: string) {
				guard();
				const row = raw.prepare(text).get(...params);
				if (!row) return null;
				return col ? (row as Record<string, unknown>)[col] : { ...row };
			},
		};
	};
	return { raw, breakIt: () => void (broken = true), prepare: (t: string) => statement(t) } as unknown as FakeD1;
}

export function makeEnv(db: D1Database): Env {
	return {
		DB: db,
		ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher,
		API: {} as Fetcher,
		ACCESS_TEAM_DOMAIN: TEAM,
		ACCESS_AUD: AUD,
		OWNER_EMAIL: OWNER,
		WEB_ORIGIN,
		API_URL: "https://capystack-api.capybaraharmony.com",
		POSTHOG_HOST: "https://us.i.posthog.com",
		POSTHOG_TOKEN: "",
	};
}

// ---- Access JWTs signed with a generated RSA key -------------------------------------------------------------------
const b64u = (b: ArrayBuffer | Uint8Array | string) => {
	const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
	let s = "";
	for (const x of bytes) s += String.fromCharCode(x);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export type Signer = {
	kid: string;
	jwk: JsonWebKey;
	sign(claims: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
};

export async function makeSigner(kid = "kid-1"): Promise<Signer> {
	const pair = (await crypto.subtle.generateKey(
		{ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
		true,
		["sign", "verify"],
	)) as CryptoKeyPair;
	const jwk: JsonWebKey & { kid: string } = { ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey), kid, alg: "RS256", use: "sig" };
	return {
		kid,
		jwk,
		async sign(claims, header = {}) {
			const h = b64u(JSON.stringify({ alg: "RS256", kid, typ: "JWT", ...header }));
			const p = b64u(JSON.stringify(claims));
			const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
			return `${h}.${p}.${b64u(sig)}`;
		},
	};
}

export const goodClaims = (over: Record<string, unknown> = {}) => ({
	aud: [AUD],
	iss: `https://${TEAM}`,
	email: OWNER,
	iat: NOW_S - 10,
	nbf: NOW_S - 10,
	exp: NOW_S + 3600,
	type: "app",
	...over,
});

export const rawToken = (header: object, claims: object, sig = "") => `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}.${sig}`;

// A JWKS endpoint stub. Records every URL it was asked for.
export function makeJwksFetch(signers: () => Signer[]) {
	const calls: string[] = [];
	const fetchFn = async (url: string) => {
		calls.push(url);
		return new Response(JSON.stringify({ keys: signers().map((s) => s.jwk) }), { headers: { "content-type": "application/json" } });
	};
	return { calls, fetchFn };
}

export const newCache = (fetchFn: (u: string) => Promise<Response>) => new JwksCache(TEAM, fetchFn);
