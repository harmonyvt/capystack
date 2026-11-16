// The route snapshot (as cobalt's test/route-snapshot.test.ts): what the Worker answers for every route the registry
// knows, for each kind of caller (no token, a key for tools, a signed-in session), pinned in
// fixtures/route-snapshot.json. A change that moves or re-guards a route shows up as a diff there; a new route adds rows.
// One row per request: status, error code, CORS, cache header, the body's top-level keys. A fresh database for each.
//
// To accept an intended change: `npx vitest run test/route-snapshot.test.ts -u`, then read the diff.
import { describe, expect, it } from "vitest";
import { REGISTRY } from "../src/registry";
import { WEB, world } from "./world";

const ID = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const CALLERS = ["none", "key", "session"] as const;

// Paths no op takes, which must stay 404.
const EXTRA: [string, string][] = [
    ["GET", "/"],
    ["GET", "/notes/"],
    ["GET", `/notes/${ID}/extra`],
    ["PUT", "/notes"],
    ["GET", "/admin"],
];

describe("route snapshot", () => {
    it("answers every route as pinned", async () => {
        const requests: [string, string][] = [...REGISTRY.ops.map((op) => [op.route.method, op.route.path.replace(/:[A-Za-z_]+/g, ID)] as [string, string]), ...EXTRA];
        const rows: string[] = [];
        for (const [method, path] of requests) {
            for (const who of CALLERS) {
                const w = world();
                const token = who === "none" ? undefined : who === "key" ? (await w.key()).token : (await w.session()).token;
                const hasBody = method === "POST" || method === "PATCH" || method === "PUT";
                const res = await w.call(method, path, { token, origin: WEB, ...(hasBody ? { body: {} } : {}) });
                const text = await res.text();
                let body: unknown = null;
                try {
                    body = text ? JSON.parse(text) : null;
                } catch {
                    body = "<not json>";
                }
                const error = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : null;
                const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body).sort().join(",") : String(body);
                rows.push(
                    [
                        `${method} ${path.replace(ID, ":id")} [${who}]`,
                        res.status,
                        error ?? "-",
                        res.headers.get("access-control-allow-origin") ? "cors" : "no-cors",
                        res.headers.get("cache-control") ?? "-",
                        keys,
                    ].join(" | "),
                );
            }
        }
        await expect(`${JSON.stringify(rows, null, 1)}\n`).toMatchFileSnapshot("fixtures/route-snapshot.json");
    });
});
