// A whole API under node for the tests: the real registry and SQL, fake clock, fake model, fake APNs and an in-memory
// JobRunner. `call()` sends a Request through handleRequest exactly as the Worker's fetch does.
import type { ApnsPush, ApnsSender, Delivery } from "../src/apns";
import type { Env } from "../src/env";
import { JobEngine, type Job, type KV } from "../src/jobs";
import { hashToken, KeyCache, mintToken, SESSION_TTL_MS } from "../src/keys";
import type { ModelClient, ModelMessage, ModelParams } from "../src/model";
import { handleRequest, REGISTRY } from "../src/registry";
import { createD1, type FakeD1 } from "./d1";

export const API = "https://capystack-api.capybaraharmony.com";
export const WEB = "https://capystack.capybaraharmony.com";
export const T0 = 1_800_000_000_000;

export class MemoryKV implements KV {
    readonly map = new Map<string, unknown>();
    async get<T>(k: string) {
        return structuredClone(this.map.get(k)) as T | undefined;
    }
    async put(k: string, v: unknown) {
        this.map.set(k, structuredClone(v));
    }
    async delete(k: string) {
        return this.map.delete(k);
    }
}

export class FakeApns implements ApnsSender {
    readonly bundleId = "com.capybaraharmony.capystack";
    readonly sent: ApnsPush[] = [];
    answer: (p: ApnsPush) => Delivery = () => ({ kind: "sent", status: 200, reason: null });
    async send(p: ApnsPush) {
        this.sent.push(p);
        return this.answer(p);
    }
}

// A model that answers from a script: each call takes the next reply (a function of the request).
export class FakeModel implements ModelClient {
    readonly calls: ModelParams[] = [];
    constructor(private readonly script: ((p: ModelParams) => Partial<ModelMessage>)[]) {}
    messages = {
        create: async (p: ModelParams): Promise<ModelMessage> => {
            this.calls.push(structuredClone(p));
            const next = this.script.shift();
            if (!next) throw new Error("the fake model ran out of replies");
            return { id: "msg", type: "message", role: "assistant", model: p.model, stop_reason: "end_turn", stop_sequence: null, usage: {} as never, content: [], ...next(p) } as ModelMessage;
        },
    };
}

export type World = {
    db: FakeD1;
    env: Env;
    clock: { now: number };
    apns: FakeApns;
    keyCache: KeyCache;
    model: ModelClient | null;
    engines: Map<string, { engine: JobEngine; kv: MemoryKV; alarm: number | null }>;
    call(method: string, path: string, o?: { token?: string; body?: unknown; headers?: Record<string, string>; origin?: string }): Promise<Response>;
    json(method: string, path: string, o?: { token?: string; body?: unknown; headers?: Record<string, string>; origin?: string }): Promise<{ status: number; body: any; headers: Headers }>;
    session(device?: string, platform?: string): Promise<{ id: string; token: string }>;
    key(name?: string): Promise<{ id: string; token: string }>;
};

export function world(o: { env?: Partial<Env>; model?: ModelClient | null; apns?: boolean } = {}): World {
    const db = createD1();
    const clock = { now: T0 };
    const apns = new FakeApns();
    const keyCache = new KeyCache();
    const engines: World["engines"] = new Map();
    const env: Env = { DB: db, CORS_URL: WEB, ...o.env };
    const w: World = {
        db,
        env,
        clock,
        apns,
        keyCache,
        model: o.model ?? null,
        engines,
        async call(method, path, c = {}) {
            const headers: Record<string, string> = { ...c.headers };
            if (c.token) headers.authorization = `Bearer ${c.token}`;
            if (c.origin) headers.origin = c.origin;
            if (c.body !== undefined) headers["content-type"] = "application/json";
            const req = new Request(API + path, { method, headers, body: c.body === undefined ? undefined : typeof c.body === "string" ? c.body : JSON.stringify(c.body) });
            return handleRequest(REGISTRY, env, req, {
                now: () => clock.now,
                keyCache,
                model: () => w.model,
                apns: o.apns === false ? null : apns,
                jobs: {
                    async start(job: Job, seconds: number) {
                        const kv = new MemoryKV();
                        const slot = { engine: null as unknown as JobEngine, kv, alarm: null as number | null };
                        slot.engine = new JobEngine({ db, storage: kv, now: () => clock.now, apns, setAlarm: async (at) => void (slot.alarm = at) });
                        engines.set(job.id, slot);
                        await slot.engine.start(job, seconds);
                    },
                },
            });
        },
        async json(method, path, c) {
            const res = await w.call(method, path, c);
            const text = await res.text();
            return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
        },
        async session(device = "test phone", platform = "ios") {
            const id = crypto.randomUUID();
            const token = mintToken();
            await db
                .prepare("INSERT INTO api_keys (id, kind, name, token_hash, device, platform, created_at, last_used_at, expires_at) VALUES (?1, 'session', ?2, ?3, ?2, ?4, ?5, ?5, ?6)")
                .bind(id, device, await hashToken(token), platform, clock.now, clock.now + SESSION_TTL_MS)
                .run();
            return { id, token };
        },
        async key(name = "test key") {
            const id = crypto.randomUUID();
            const token = mintToken();
            await db.prepare("INSERT INTO api_keys (id, kind, name, token_hash, created_at) VALUES (?1, 'key', ?2, ?3, ?4)").bind(id, name, await hashToken(token), clock.now).run();
            return { id, token };
        },
    };
    return w;
}
