// APNs with token auth (docs/CONTRACT.md section 8), ported from cobalt's api/src/apns.ts minus its helper-container
// transport: the ES256 provider token, the request headers, and what each answer means. Pure: fetch, crypto.subtle and
// the clock are injected, so it runs under plain node in the tests. No Cloudflare imports.
//
// Nothing secret is ever logged: not the key, not the JWT, not a full device token (the first 8 characters at most).

export type ApnsEnvironment = "sandbox" | "production";
export type PushType = "background" | "alert" | "liveactivity";

export const APNS_HOSTS: Record<ApnsEnvironment, string> = {
    production: "api.push.apple.com",
    sandbox: "api.sandbox.push.apple.com",
};

// A provider token is reused this long (Apple: refresh between 20 and 60 minutes; refreshing more often answers
// TooManyProviderTokenUpdates).
export const JWT_REUSE_MS = 50 * 60 * 1000;
export const APNS_CALL_MS = 5000;

export type ApnsConfig = { keyP8: string; keyId: string; teamId: string; bundleId: string; forceEnv: ApnsEnvironment | null };

type EnvLike = { APNS_KEY_P8?: unknown; APNS_KEY_ID?: unknown; APNS_TEAM_ID?: unknown; APNS_BUNDLE_ID?: unknown; APNS_ENV?: unknown };
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

// All three secrets present, else null (no pushes, features.push false).
export function apnsConfigFrom(env: EnvLike): ApnsConfig | null {
    if (!nonEmpty(env.APNS_KEY_P8) || !nonEmpty(env.APNS_KEY_ID) || !nonEmpty(env.APNS_TEAM_ID)) return null;
    const forced = typeof env.APNS_ENV === "string" ? env.APNS_ENV.trim().toLowerCase() : "";
    return {
        keyP8: env.APNS_KEY_P8,
        keyId: env.APNS_KEY_ID.trim(),
        teamId: env.APNS_TEAM_ID.trim(),
        bundleId: nonEmpty(env.APNS_BUNDLE_ID) ? env.APNS_BUNDLE_ID.trim() : "com.capybaraharmony.capystack",
        forceEnv: forced === "sandbox" || forced === "production" ? forced : null,
    };
}

// ---- base64 / JWT -------------------------------------------------------------------------------------------------

export function b64url(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const textBytes = (s: string) => new TextEncoder().encode(s);

// PEM (one string; "\n" may arrive as real newlines or as backslash-n when a secrets file was escaped twice) -> the
// PKCS#8 DER bytes.
export function pemToDer(pem: string): Uint8Array {
    const body = pem
        .replace(/\\n/g, "\n")
        .replace(/-----BEGIN [A-Z ]+-----/g, "")
        .replace(/-----END [A-Z ]+-----/g, "")
        .replace(/[^A-Za-z0-9+/=]/g, "");
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// The ES256 provider token: header {alg, kid}, claims {iss: team id, iat: seconds}. WebCrypto's ECDSA signature is
// already the raw 64-byte r||s that JWS wants.
export async function signProviderToken(cfg: Pick<ApnsConfig, "keyP8" | "keyId" | "teamId">, nowMs: number, subtle: SubtleCrypto = crypto.subtle): Promise<string> {
    const key = await subtle.importKey("pkcs8", pemToDer(cfg.keyP8), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const header = b64url(textBytes(JSON.stringify({ alg: "ES256", kid: cfg.keyId })));
    const claims = b64url(textBytes(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(nowMs / 1000) })));
    const input = `${header}.${claims}`;
    const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, textBytes(input));
    return `${input}.${b64url(new Uint8Array(sig))}`;
}

// ---- sending ------------------------------------------------------------------------------------------------------

export type ApnsPush = {
    token: string;
    env: ApnsEnvironment;
    type: PushType;
    priority: 5 | 10;
    payload: unknown;
    // unix seconds; 0 = deliver now or never
    expiration?: number;
};

// What became of one push:
//  - sent: Apple took it
//  - drop: the token is dead (410, BadDeviceToken, Unregistered, DeviceTokenNotForTopic): forget it
//  - failed: anything else (403 other, 429, 5xx, network); try again on the next event
export type Delivery = { kind: "sent" | "drop" | "failed"; status: number; reason: string | null };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

// What the rest of the code sends with (ctx.apns). Tests pass a fake.
export type ApnsSender = { readonly bundleId: string; send(push: ApnsPush): Promise<Delivery> };

const DEAD_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic", "ExpiredToken"]);
const short = (t: string) => t.slice(0, 8);

export class ApnsClient implements ApnsSender {
    private jwt: { token: string; at: number } | null = null;
    private signing: Promise<string> | null = null;

    constructor(
        private readonly cfg: ApnsConfig,
        private readonly d: { fetch: FetchLike; now: () => number; subtle?: SubtleCrypto; log?: (line: string) => void },
    ) {}

    get bundleId(): string {
        return this.cfg.bundleId;
    }

    topicFor(type: PushType): string {
        return type === "liveactivity" ? `${this.cfg.bundleId}.push-type.liveactivity` : this.cfg.bundleId;
    }

    // The provider token, reused for 50 minutes; concurrent callers share one signing.
    async token(force = false): Promise<string> {
        const now = this.d.now();
        if (!force && this.jwt && now - this.jwt.at < JWT_REUSE_MS) return this.jwt.token;
        this.signing ??= signProviderToken(this.cfg, now, this.d.subtle)
            .then((token) => {
                this.jwt = { token, at: this.d.now() };
                return token;
            })
            .finally(() => (this.signing = null));
        return this.signing;
    }

    // The request for one push (exported shape for the tests).
    requestFor(push: ApnsPush, jwt: string): { url: string; init: RequestInit & { headers: Record<string, string> } } {
        const env = this.cfg.forceEnv ?? push.env;
        return {
            url: `https://${APNS_HOSTS[env]}/3/device/${push.token}`,
            init: {
                method: "POST",
                headers: {
                    authorization: `bearer ${jwt}`,
                    "apns-topic": this.topicFor(push.type),
                    "apns-push-type": push.type,
                    "apns-priority": String(push.priority),
                    "apns-expiration": String(push.expiration ?? 0),
                    "content-type": "application/json",
                },
                body: JSON.stringify(push.payload),
            },
        };
    }

    async send(push: ApnsPush): Promise<Delivery> {
        let jwt: string;
        try {
            jwt = await this.token();
        } catch (e) {
            this.line(push, 0, `jwt: ${e instanceof Error ? e.message : "error"}`);
            return { kind: "failed", status: 0, reason: "jwt" };
        }
        let answer = await this.attempt(push, jwt);
        // An expired provider token: sign once more and try again.
        if (answer.status === 403 && answer.reason === "ExpiredProviderToken") {
            try {
                answer = await this.attempt(push, await this.token(true));
            } catch {
                // keep the first answer
            }
        }
        if (answer.status === 200) return { kind: "sent", status: 200, reason: null };
        if (answer.status === 410 || (answer.status === 400 && answer.reason !== null && DEAD_REASONS.has(answer.reason))) {
            return { kind: "drop", status: answer.status, reason: answer.reason };
        }
        return { kind: "failed", status: answer.status, reason: answer.reason };
    }

    private async attempt(push: ApnsPush, jwt: string): Promise<{ status: number; reason: string | null }> {
        const { url, init } = this.requestFor(push, jwt);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timed out")), APNS_CALL_MS)));
            const res = await Promise.race([this.d.fetch(url, init), timeout]);
            let reason: string | null = null;
            try {
                const j = (await res.json()) as { reason?: unknown };
                if (typeof j?.reason === "string") reason = j.reason;
            } catch {
                // a 200 has no body
            }
            this.line(push, res.status, reason);
            return { status: res.status, reason };
        } catch (e) {
            const msg = (e instanceof Error ? e.message : String(e)).split(push.token).join(short(push.token)).split(jwt).join("<jwt>").slice(0, 120);
            this.line(push, 0, `transport: ${msg}`);
            return { status: 0, reason: `transport: ${msg}` };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private line(push: ApnsPush, status: number, reason: string | null) {
        (this.d.log ?? ((l) => console.log(l)))(`[apns] ${status} ${reason ?? "-"} type=${push.type} token=${short(push.token)}`);
    }
}

// ---- payloads -----------------------------------------------------------------------------------------------------

// The "pull now" hint (section 5): a silent background push. Nothing rides on it.
export const backgroundPayload = () => ({ aps: { "content-available": 1 } });

// The Live Activity (section 8): ActivityAttributes JobActivityAttributes { jobId, kind }, ContentState
// { title, progress, state, updatedAt } with updatedAt in seconds since 1970.
export const JOB_ATTRIBUTES_TYPE = "JobActivityAttributes";
export const LIVE_STALE_S = 120;
export const LIVE_DISMISS_S = 15 * 60;

export type JobContentState = { title: string; progress: number; state: string; updatedAt: number };

const secs = (ms: number) => Math.floor(ms / 1000);

export const contentState = (j: { title: string; progress: number; state: string }, nowMs: number): JobContentState => ({
    title: j.title,
    progress: Math.round(Math.min(1, Math.max(0, j.progress)) * 1000) / 1000,
    state: j.state,
    updatedAt: secs(nowMs),
});

export function liveStartPayload(job: { id: string; kind: string; title: string; progress: number; state: string }, nowMs: number) {
    return {
        aps: {
            timestamp: secs(nowMs),
            event: "start",
            "attributes-type": JOB_ATTRIBUTES_TYPE,
            attributes: { jobId: job.id, kind: job.kind },
            "content-state": contentState(job, nowMs),
            "stale-date": secs(nowMs) + LIVE_STALE_S,
            "input-push-token": 1,
            alert: { title: "capystack", body: job.title },
        },
    };
}

export function liveUpdatePayload(job: { title: string; progress: number; state: string }, nowMs: number) {
    return { aps: { timestamp: secs(nowMs), event: "update", "content-state": contentState(job, nowMs), "stale-date": secs(nowMs) + LIVE_STALE_S } };
}

export function liveEndPayload(job: { title: string; progress: number; state: string }, nowMs: number) {
    return {
        aps: {
            timestamp: secs(nowMs),
            event: "end",
            "content-state": contentState(job, nowMs),
            "dismissal-date": secs(nowMs) + LIVE_DISMISS_S,
            alert: { title: "capystack", body: job.state === "done" ? `${job.title} is done` : `${job.title} didn't finish` },
        },
    };
}
