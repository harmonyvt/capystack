// The registry's HTTP rules (docs/CONTRACT.md section 4): 404 for unknown routes, CORS for the web origin only, the
// preflight, error bodies, and the op definitions' own checks.
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { anthropicTools } from "../src/registry/ai";
import { REGISTRY } from "../src/registry";
import { defineOp, ok } from "../src/registry/op";
import { Registry } from "../src/registry/registry";
import { WEB, world } from "./world";

describe("routing", () => {
    it("answers 404 not_found to anything no op takes", async () => {
        const w = world();
        expect(await w.json("GET", "/nope")).toMatchObject({ status: 404, body: { error: "not_found" } });
        expect((await w.json("GET", "/notes/")).status).toBe(404);
        expect((await w.json("PUT", "/notes")).status).toBe(404);
    });

    it("prefers a literal segment over a param", () => {
        const r = new Registry([
            defineOp({ name: "a.param", route: { method: "GET", path: "/x/:id" }, auth: "open", input: z.any(), handler: async () => ok(1) }),
            defineOp({ name: "a.lit", route: { method: "GET", path: "/x/new" }, auth: "open", input: z.any(), handler: async () => ok(2) }),
        ]);
        expect(r.match("GET", "/x/new")?.op.name).toBe("a.lit");
        expect(r.match("GET", "/x/7")).toMatchObject({ op: { name: "a.param" }, params: { id: "7" } });
    });

    it("refuses two ops on one route and an MCP tool with no tier", () => {
        const op = () => defineOp({ name: `o${Math.random()}`, route: { method: "GET", path: "/same" }, auth: "open", input: z.any(), handler: async () => ok(1) });
        expect(() => new Registry([op(), op()])).toThrow(/twice/);
        expect(() => defineOp({ name: "m", route: { method: "GET", path: "/m" }, auth: "open", input: z.any(), mcp: true, handler: async () => ok(1) })).toThrow();
    });
});

describe("CORS", () => {
    it("adds the web origin's headers to answers, errors included", async () => {
        const w = world();
        const ok = await w.call("GET", "/capabilities", { origin: WEB });
        expect(ok.headers.get("access-control-allow-origin")).toBe(WEB);
        expect(ok.headers.get("access-control-expose-headers")).toContain("x-change-seq");
        const denied = await w.call("GET", "/notes", { origin: WEB });
        expect(denied.status).toBe(401);
        expect(denied.headers.get("access-control-allow-origin")).toBe(WEB);
        const other = await w.call("GET", "/capabilities", { origin: "https://evil.example" });
        expect(other.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("answers the web origin's preflight, refuses others, 404s unknown paths", async () => {
        const w = world();
        const pre = await w.call("OPTIONS", "/notes/abc", { origin: WEB });
        expect(pre.status).toBe(204);
        expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
        expect(pre.headers.get("access-control-allow-headers")).toContain("idempotency-key");
        expect((await w.call("OPTIONS", "/notes", { origin: "https://evil.example" })).status).toBe(403);
        expect((await w.call("OPTIONS", "/nope", { origin: WEB })).status).toBe(404);
    });
});

describe("input and errors", () => {
    it("answers 400 bad_request with a message to a bad body", async () => {
        const w = world();
        const { token } = await w.session();
        expect(await w.json("POST", "/notes", { token, body: "{" })).toMatchObject({ status: 400, body: { error: "bad_request" } });
        const r = await w.json("POST", "/notes", { token, body: { title: 5 } });
        expect(r.status).toBe(400);
        expect(r.body.message).toContain("title");
    });

    it("answers capabilities with every feature off on a bare deploy", async () => {
        const w = world();
        expect((await w.json("GET", "/capabilities")).body).toEqual({
            name: "capystack",
            version: "0.1.0",
            features: { ai: false, push: false, posthog: false, mcp: true },
            posthog: { host: "https://us.i.posthog.com", token: "" },
        });
        const on = world({ env: { ANTHROPIC_API_KEY: "sk", POSTHOG_TOKEN: "phc_x", APNS_KEY_P8: "p", APNS_KEY_ID: "k", APNS_TEAM_ID: "t" } });
        expect((await on.json("GET", "/capabilities")).body).toMatchObject({ features: { ai: true, push: true, posthog: true }, posthog: { token: "phc_x" } });
    });
});

describe("AI tools", () => {
    it("are the ops with a tier, named with underscores, with JSON Schema input", () => {
        const tools = anthropicTools(REGISTRY);
        expect(tools.map((t) => t.name)).toEqual(["notes_list", "notes_get", "notes_create", "notes_update", "notes_delete"]);
        expect(tools.find((t) => t.name === "notes_delete")!.description).toContain("check with the owner");
        expect(tools.find((t) => t.name === "notes_create")!.input_schema).toMatchObject({ type: "object", properties: { title: { type: "string" } } });
    });
});
