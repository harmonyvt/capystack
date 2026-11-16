import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lookupToken } from "../../api/src/keys";
import type { Env } from "../src/lib/server/env";
import { hashToken } from "../src/lib/server/http";
import { handleKeys, MAX_KEYS } from "../src/lib/server/keys";
import { createFakeD1, goodClaims, makeEnv, makeJwksFetch, makeSigner, newCache, NOW, OWNER, WEB_ORIGIN, type FakeD1, type Signer } from "./support";

const SAMPLE = "0b5f2c3e-6c1a-4f5e-9a57-1d0e6c9f2a11";
const SAMPLE_SHA256 = "fdf22b6208069ca909f67671aa94460362cf0f181093d0ad9f31e12e08fad7d9";
const TOKEN_43 = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

type Opts = { token?: string | null; origin?: string | null; body?: unknown; contentType?: string | null; raw?: string };
const call = (method: string, path: string, o: Opts = {}) => {
	const headers = new Headers();
	const t = o.token === undefined ? token : o.token;
	if (t) headers.set("Cf-Access-Jwt-Assertion", t);
	if (o.origin !== null && (method !== "GET" || o.origin)) headers.set("Origin", o.origin ?? WEB_ORIGIN);
	let body: string | undefined;
	if (method === "GET") body = undefined;
	else if (o.raw !== undefined) body = o.raw;
	else if (o.body !== undefined) body = JSON.stringify(o.body);
	if ((body !== undefined || o.contentType !== undefined) && o.contentType !== null) headers.set("content-type", o.contentType ?? "application/json");
	return handleKeys(new Request(`${WEB_ORIGIN}${path}`, { method, headers, body }), env, deps());
};
const create = (name: unknown = "claude code", o: Opts = {}) => call("POST", "/api/keys", { body: { name }, ...o });
const json = async (r: Response) => JSON.parse(await r.text());

describe("hashToken", () => {
	it("matches the vector pinned in the API Worker tests", async () => {
		expect(await hashToken(SAMPLE)).toBe(SAMPLE_SHA256);
		expect(createHash("sha256").update(SAMPLE).digest("hex")).toBe(SAMPLE_SHA256); // independent of WebCrypto
	});
});

describe("authentication", () => {
	it.each(["GET", "POST", "DELETE"])("%s without a JWT is 401 auth.required and never touches D1", async (method) => {
		db.breakIt(); // would 500 if reached
		const r = await call(method, method === "DELETE" ? `/api/keys/${crypto.randomUUID()}` : "/api/keys", { token: null, body: { name: "x" } });
		expect(r.status).toBe(401);
		expect(await json(r)).toEqual({ error: "auth.required" });
	});
	it("a JWT for another email is 401", async () => {
		const bad = await signer.sign(goodClaims({ email: "someone@else.com" }));
		expect((await call("GET", "/api/keys", { token: bad })).status).toBe(401);
	});
	it("auth is checked before Origin (a bad-origin unauthenticated POST is 401, not 403)", async () => {
		expect((await create("x", { token: null, origin: "https://evil.example" })).status).toBe(401);
	});
});

describe("headers", () => {
	it("every response is JSON with no-store and no CORS", async () => {
		for (const r of [
			await call("GET", "/api/keys"),
			await create("a"),
			await call("GET", "/api/keys", { token: null }),
			await create("a", { origin: "https://evil.example" }),
			await create(""),
		]) {
			expect(r.headers.get("cache-control")).toBe("no-store");
			expect(r.headers.get("content-type")).toBe("application/json");
			expect([...r.headers.keys()].filter((h) => h.startsWith("access-control-"))).toEqual([]);
		}
		expect((await call("DELETE", `/api/keys/${crypto.randomUUID()}`)).headers.get("cache-control")).toBe("no-store");
	});
});

describe("GET /api/keys", () => {
	it("is empty at first", async () => {
		const r = await call("GET", "/api/keys");
		expect(r.status).toBe(200);
		expect(await json(r)).toEqual({ keys: [] });
	});
	it("lists non-revoked keys newest first with exactly the contract fields and no secrets", async () => {
		const a = await json(await create("first"));
		clock += 1000;
		const b = await json(await create("second"));
		clock += 1000;
		const c = await json(await create("third"));
		await call("DELETE", `/api/keys/${b.key.id}`);
		const body = await json(await call("GET", "/api/keys"));
		expect(body.keys.map((k: { name: string }) => k.name)).toEqual(["third", "first"]);
		for (const k of body.keys) {
			expect(Object.keys(k).sort()).toEqual(["created_at", "id", "last_used_at", "name"]);
			expect(k.last_used_at).toBeNull();
		}
		expect(body.keys[0]).toMatchObject({ id: c.key.id, created_at: NOW + 2000 });
		expect(JSON.stringify(body)).not.toContain(a.token);
	});
	it("reflects last_used_at set by the API Worker", async () => {
		const a = await json(await create("x"));
		db.raw.prepare("UPDATE api_keys SET last_used_at = 424242 WHERE id = ?").run(a.key.id);
		expect((await json(await call("GET", "/api/keys"))).keys[0].last_used_at).toBe(424242);
	});
	it("needs no Origin", async () => {
		expect((await call("GET", "/api/keys", { origin: null })).status).toBe(200);
	});
});

describe("POST /api/keys", () => {
	it("creates a key: 201, contract shape, the token once, only the hash stored", async () => {
		const r = await create("  claude code  ");
		expect(r.status).toBe(201);
		const b = await json(r);
		expect(Object.keys(b).sort()).toEqual(["key", "token"]);
		expect(Object.keys(b.key).sort()).toEqual(["created_at", "id", "last_used_at", "name"]);
		expect(b.key.name).toBe("claude code");
		expect(b.token).toMatch(TOKEN_43);
		expect(b.key.id).toMatch(UUID);
		expect(b.key.created_at).toBe(NOW);
		expect(b.key.last_used_at).toBeNull();

		const row = db.raw.prepare("SELECT * FROM api_keys WHERE id = ?").get(b.key.id)!;
		expect(row).toMatchObject({ kind: "key", name: "claude code", token_hash: await hashToken(b.token), expires_at: null, revoked_at: null });
		expect(JSON.stringify(row)).not.toContain(b.token);
		expect(await (await call("GET", "/api/keys")).text()).not.toContain(b.token); // the list never repeats it
		expect((await lookupToken(db, b.token, NOW + 1))?.kind).toBe("key"); // and the API Worker accepts it
	});
	it("validates name: trimmed 1..40 chars", async () => {
		for (const name of ["", "   ", "\n\t", "x".repeat(41), "  " + "x".repeat(41) + "  ", 5, null, ["a"], {}]) {
			const r = await create(name);
			expect(r.status, "name=" + String(JSON.stringify(name))).toBe(400);
			expect(await json(r)).toEqual({ error: "bad_request" });
		}
		expect((await call("POST", "/api/keys", { body: {} })).status).toBe(400); // no name at all
		expect((await create("x".repeat(40))).status).toBe(201);
		expect((await create("x")).status).toBe(201);
		expect((await create(" " + "y".repeat(40) + " ")).status).toBe(201);
		expect((await create("\u{1F600}".repeat(40))).status).toBe(201); // counted in characters
		expect((await create("\u{1F600}".repeat(41))).status).toBe(400);
	});
	it("400 for a missing body, invalid JSON, a non-object body, or an oversized body", async () => {
		expect((await call("POST", "/api/keys", { contentType: "application/json" })).status).toBe(400);
		expect((await call("POST", "/api/keys", { raw: "{nope" })).status).toBe(400);
		expect((await call("POST", "/api/keys", { raw: '"name"' })).status).toBe(400);
		expect((await call("POST", "/api/keys", { raw: "[]" })).status).toBe(400);
		expect((await call("POST", "/api/keys", { body: { name: "ok", pad: "z".repeat(5000) } })).status).toBe(400);
	});
	it("requires content-type application/json", async () => {
		const wrong = await call("POST", "/api/keys", { body: { name: "x" }, contentType: "text/plain" });
		expect(wrong.status).toBe(415);
		expect(await json(wrong)).toEqual({ error: "bad_request" });
		expect((await call("POST", "/api/keys", { body: { name: "x" }, contentType: null })).status).toBe(415);
		expect((await call("POST", "/api/keys", { body: { name: "x" }, contentType: "application/json; charset=utf-8" })).status).toBe(201);
	});
	it("requires Origin to be exactly the web origin", async () => {
		for (const origin of ["https://evil.example", `${WEB_ORIGIN}.evil.example`, WEB_ORIGIN.replace("https", "http"), WEB_ORIGIN + "/", "null"]) {
			const r = await create("x", { origin });
			expect(r.status, origin).toBe(403);
			expect(await json(r)).toEqual({ error: "auth.forbidden" });
		}
		expect((await create("x", { origin: null })).status).toBe(403);
		expect((await json(await call("GET", "/api/keys"))).keys).toEqual([]); // nothing was created
	});
	it(`caps at ${MAX_KEYS} active keys with 409 keys.too_many; revoking frees a slot`, async () => {
		const ids: string[] = [];
		for (let i = 0; i < MAX_KEYS; i++) ids.push((await json(await create(`k${i}`))).key.id);
		const over = await create("one too many");
		expect(over.status).toBe(409);
		expect(await json(over)).toEqual({ error: "keys.too_many" });
		expect(db.raw.prepare("SELECT COUNT(*) AS n FROM api_keys").get()!.n).toBe(MAX_KEYS);

		expect((await call("DELETE", `/api/keys/${ids[0]}`)).status).toBe(204);
		expect((await create("fits again")).status).toBe(201);
		expect((await create("full again")).status).toBe(409);
	});
	it("D1 failure is 500 server_error", async () => {
		db.breakIt();
		const r = await create("x");
		expect(r.status).toBe(500);
		expect(await json(r)).toEqual({ error: "server_error" });
	});
});

describe("DELETE /api/keys/:id", () => {
	it("revokes: 204 with no body, then it is gone from the list and the API Worker refuses its token", async () => {
		const a = await json(await create("a"));
		expect((await lookupToken(db, a.token, NOW + 1))?.id).toBe(a.key.id);
		const r = await call("DELETE", `/api/keys/${a.key.id}`);
		expect(r.status).toBe(204);
		expect(await r.text()).toBe("");
		expect((await json(await call("GET", "/api/keys"))).keys).toEqual([]);
		expect(db.raw.prepare("SELECT revoked_at FROM api_keys WHERE id = ?").get(a.key.id)!.revoked_at).toBe(NOW);
		expect(await lookupToken(db, a.token, NOW + 2)).toBeNull();
	});
	it("unknown or already revoked id is 404 not_found, the first revocation time kept", async () => {
		const a = await json(await create("a"));
		for (const id of [crypto.randomUUID(), "nope", "..%2Fkeys"]) {
			const r = await call("DELETE", `/api/keys/${id}`);
			expect(r.status, id).toBe(404);
			expect(await json(r)).toEqual({ error: "not_found" });
		}
		expect((await call("DELETE", `/api/keys/${a.key.id}`)).status).toBe(204);
		clock += 5;
		const again = await call("DELETE", `/api/keys/${a.key.id}`);
		expect(again.status).toBe(404);
		expect(db.raw.prepare("SELECT revoked_at FROM api_keys WHERE id = ?").get(a.key.id)!.revoked_at).toBe(NOW);
	});
	it("requires the web Origin (403) and revokes nothing otherwise", async () => {
		const a = await json(await create("a"));
		for (const origin of ["https://evil.example", null] as const) {
			const r = await call("DELETE", `/api/keys/${a.key.id}`, { origin });
			expect(r.status).toBe(403);
			expect(await json(r)).toEqual({ error: "auth.forbidden" });
		}
		expect((await json(await call("GET", "/api/keys"))).keys).toHaveLength(1);
	});
});

describe("routing", () => {
	it("wrong methods are 405 and unknown paths 404 (both authenticated)", async () => {
		expect((await call("PUT", "/api/keys")).status).toBe(405);
		expect((await call("DELETE", "/api/keys")).status).toBe(405);
		expect((await call("GET", `/api/keys/${crypto.randomUUID()}`)).status).toBe(405);
		expect((await call("GET", "/api/keys/")).status).toBe(404);
		expect((await call("GET", "/api/keys/a/b")).status).toBe(404);
	});
});

// Device sessions share the api_keys table (kind = 'session'); /api/keys only ever sees kind = 'key'.
describe("device sessions are not keys", () => {
	const seedSession = (id: string) =>
		db.raw
			.prepare("INSERT INTO api_keys (id, kind, name, token_hash, device, platform, created_at, last_used_at, expires_at) VALUES (?, 'session', 'phone', ?, 'phone', 'ios', ?, ?, ?)")
			.run(id, "h-" + id, NOW + 5000, NOW + 5000, NOW + 10_000_000);
	it("GET leaves sessions out", async () => {
		const a = await json(await create("tool"));
		seedSession(crypto.randomUUID());
		expect((await json(await call("GET", "/api/keys"))).keys.map((k: { id: string }) => k.id)).toEqual([a.key.id]);
	});
	it("sessions do not count against the key cap", async () => {
		for (let i = 0; i < 60; i++) seedSession(crypto.randomUUID());
		for (let i = 0; i < MAX_KEYS; i++) expect((await create(`k${i}`)).status).toBe(201);
		expect((await create("one too many")).status).toBe(409);
	});
	it("DELETE never revokes a session: 404, the row untouched", async () => {
		const id = crypto.randomUUID();
		seedSession(id);
		expect((await call("DELETE", `/api/keys/${id}`)).status).toBe(404);
		expect(db.raw.prepare("SELECT revoked_at FROM api_keys WHERE id = ?").get(id)).toEqual({ revoked_at: null });
	});
});

describe("the owner", () => {
	it("is the only email that passes", async () => {
		expect(OWNER).toBe("owner@example.com");
		expect((await call("GET", "/api/keys", { token: await signer.sign(goodClaims({ email: OWNER.toUpperCase() })) })).status).toBe(200);
	});
});
