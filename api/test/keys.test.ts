// Keys for tools (docs/CONTRACT.md section 3): made, listed and revoked by a signed-in device; the token is shown once.
import { describe, expect, it } from "vitest";
import { world } from "./world";

describe("keys for tools", () => {
    it("creates a key whose token works, lists it, and revokes it at once", async () => {
        const w = world();
        const s = await w.session();
        // the token is cached by this isolate first
        const made = await w.json("POST", "/auth/keys", { token: s.token, body: { name: "claude code" } });
        expect(made.status).toBe(201);
        expect(made.body.key).toMatchObject({ name: "claude code", last_used_at: null });
        expect(made.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect((await w.json("GET", "/notes", { token: made.body.token })).status).toBe(200);

        const list = await w.json("GET", "/auth/keys", { token: s.token });
        expect(list.body.keys.map((k: any) => k.name)).toEqual(["claude code"]);
        expect(JSON.stringify(list.body)).not.toContain(made.body.token);

        expect((await w.json("DELETE", `/auth/keys/${made.body.key.id}`, { token: s.token })).status).toBe(200);
        // revoked through this isolate: the cache was emptied, so the key is refused on its very next request
        expect((await w.json("GET", "/notes", { token: made.body.token })).status).toBe(401);
        expect((await w.json("DELETE", `/auth/keys/${made.body.key.id}`, { token: s.token })).status).toBe(404);
    });

    it("checks the name", async () => {
        const w = world();
        const s = await w.session();
        expect(await w.json("POST", "/auth/keys", { token: s.token, body: { name: "   " } })).toMatchObject({ status: 400, body: { error: "keys.name_invalid" } });
        expect((await w.json("POST", "/auth/keys", { token: s.token, body: { name: "x".repeat(41) } })).status).toBe(400);
    });

    it("never lists sessions as keys", async () => {
        const w = world();
        const s = await w.session();
        expect((await w.json("GET", "/auth/keys", { token: s.token })).body.keys).toEqual([]);
    });
});
