// APNs (src/apns.ts): the provider token's shape and signature, its reuse, the request headers, and what each answer
// means. A real P-256 key made for the test; no network.
import { describe, expect, it } from "vitest";
import { ApnsClient, apnsConfigFrom, JWT_REUSE_MS, liveStartPayload, signProviderToken, type ApnsPush } from "../src/apns";

async function p8(): Promise<{ pem: string; pub: CryptoKey }> {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
    const b64 = Buffer.from(der).toString("base64");
    // as a secrets file holds it: one string with escaped newlines
    return { pem: `-----BEGIN PRIVATE KEY-----\\n${b64.match(/.{1,64}/g)!.join("\\n")}\\n-----END PRIVATE KEY-----`, pub: pair.publicKey };
}

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

describe("the provider token", () => {
    it("is an ES256 JWT with kid, iss and iat that verifies with the key", async () => {
        const { pem, pub } = await p8();
        const jwt = await signProviderToken({ keyP8: pem, keyId: "KEYID12345", teamId: "TEAM123456" }, 1_800_000_000_000);
        const [h, c, s] = jwt.split(".");
        expect(JSON.parse(fromB64url(h!).toString())).toEqual({ alg: "ES256", kid: "KEYID12345" });
        expect(JSON.parse(fromB64url(c!).toString())).toEqual({ iss: "TEAM123456", iat: 1_800_000_000 });
        const sig = fromB64url(s!);
        expect(sig.length).toBe(64);
        expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sig, new TextEncoder().encode(`${h}.${c}`))).toBe(true);
    });
});

describe("ApnsClient", () => {
    const push = (o: Partial<ApnsPush> = {}): ApnsPush => ({ token: "ab".repeat(32), env: "sandbox", type: "liveactivity", priority: 10, payload: { aps: {} }, ...o });

    async function client(answers: { status: number; reason?: string }[], env: Record<string, string> = {}) {
        const { pem } = await p8();
        const cfg = apnsConfigFrom({ APNS_KEY_P8: pem, APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_BUNDLE_ID: "com.capybaraharmony.capystack", ...env })!;
        const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
        const clock = { now: 1_800_000_000_000 };
        const c = new ApnsClient(cfg, {
            now: () => clock.now,
            log: () => {},
            fetch: async (url, init) => {
                calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
                const a = answers.shift() ?? { status: 200 };
                return new Response(a.reason ? JSON.stringify({ reason: a.reason }) : null, { status: a.status });
            },
        });
        return { c, calls, clock };
    }

    it("is off without all three secrets", () => {
        expect(apnsConfigFrom({ APNS_KEY_P8: "x", APNS_KEY_ID: "", APNS_TEAM_ID: "t" })).toBeNull();
    });

    it("sends a Live Activity push with the liveactivity topic and headers", async () => {
        const { c, calls } = await client([{ status: 200 }]);
        expect(await c.send(push())).toEqual({ kind: "sent", status: 200, reason: null });
        expect(calls[0]!.url).toBe(`https://api.sandbox.push.apple.com/3/device/${"ab".repeat(32)}`);
        expect(calls[0]!.headers).toMatchObject({
            "apns-topic": "com.capybaraharmony.capystack.push-type.liveactivity",
            "apns-push-type": "liveactivity",
            "apns-priority": "10",
        });
        expect(calls[0]!.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    });

    it("uses the bundle id as the topic for background pushes, and APNS_ENV can force the host", async () => {
        const { c, calls } = await client([{ status: 200 }], { APNS_ENV: "production" });
        await c.send(push({ type: "background", priority: 5 }));
        expect(calls[0]!.url).toContain("api.push.apple.com");
        expect(calls[0]!.headers["apns-topic"]).toBe("com.capybaraharmony.capystack");
    });

    it("reuses the token for 50 minutes, and signs again after", async () => {
        const { c, calls, clock } = await client([]);
        await c.send(push());
        clock.now += JWT_REUSE_MS - 1000;
        await c.send(push());
        expect(calls[1]!.headers.authorization).toBe(calls[0]!.headers.authorization);
        clock.now += 2000;
        await c.send(push());
        expect(calls[2]!.headers.authorization).not.toBe(calls[0]!.headers.authorization);
    });

    it("drops dead tokens, signs again once on ExpiredProviderToken, and reports other failures", async () => {
        expect(await (await client([{ status: 410, reason: "Unregistered" }])).c.send(push())).toMatchObject({ kind: "drop" });
        expect(await (await client([{ status: 400, reason: "BadDeviceToken" }])).c.send(push())).toMatchObject({ kind: "drop" });
        const expired = await client([{ status: 403, reason: "ExpiredProviderToken" }, { status: 200 }]);
        expect(await expired.c.send(push())).toMatchObject({ kind: "sent" });
        expect(expired.calls).toHaveLength(2);
        expect(await (await client([{ status: 500, reason: "InternalServerError" }])).c.send(push())).toMatchObject({ kind: "failed", status: 500 });
    });
});

describe("the Live Activity payload", () => {
    it("matches JobActivityAttributes and its ContentState, dates in seconds since 1970", () => {
        const p = liveStartPayload({ id: "j1", kind: "demo", title: "demo job", progress: 0.1234, state: "running" }, 1_800_000_000_500);
        expect(p.aps).toMatchObject({
            event: "start",
            "attributes-type": "JobActivityAttributes",
            attributes: { jobId: "j1", kind: "demo" },
            "content-state": { title: "demo job", progress: 0.123, state: "running", updatedAt: 1_800_000_000 },
            timestamp: 1_800_000_000,
        });
        expect(Object.keys(p.aps["content-state"]).sort()).toEqual(["progress", "state", "title", "updatedAt"]);
    });
});
