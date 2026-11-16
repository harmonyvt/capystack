// The registry: the list of ops, matched by route and looked up by their tool names (as cobalt's registry.ts).
import type { Op } from "./op";

type Compiled = { op: Op; segments: ({ lit: string } | { param: string })[] };

export type RouteMatch = { op: Op; params: Record<string, string> };

export class Registry {
    readonly ops: readonly Op[];
    #routes: Compiled[] = [];
    #byName = new Map<string, Op>();
    #byTool = new Map<string, Op>();

    constructor(ops: readonly Op[]) {
        this.ops = ops;
        const routeKeys = new Set<string>();
        for (const op of ops) {
            if (this.#byName.has(op.name)) throw new Error(`op ${op.name} is defined twice`);
            this.#byName.set(op.name, op);
            if (op.tier !== "hidden") {
                if (this.#byTool.has(op.toolName)) throw new Error(`tool ${op.toolName} is taken (${op.name})`);
                this.#byTool.set(op.toolName, op);
            }
            const segments = op.route.path
                .split("/")
                .slice(1)
                .map((s) => (s.startsWith(":") ? { param: s.slice(1) } : { lit: s }));
            const key = `${op.route.method} ${segments.map((s) => ("lit" in s ? s.lit : ":")).join("/")}`;
            if (routeKeys.has(key)) throw new Error(`route ${op.route.method} ${op.route.path} is defined twice`);
            routeKeys.add(key);
            this.#routes.push({ op, segments });
        }
    }

    op(name: string): Op | undefined {
        return this.#byName.get(name);
    }

    byTool(name: string): Op | undefined {
        return this.#byTool.get(name);
    }

    // The op for a method and path, or null. Exact segments only: a trailing slash or an extra segment is no match.
    // Literal segments win over params, so the order ops are listed in never decides.
    match(method: string, pathname: string): RouteMatch | null {
        const parts = pathname.split("/").slice(1);
        let best: { m: RouteMatch; lits: number } | null = null;
        for (const r of this.#routes) {
            if (r.op.route.method !== method || r.segments.length !== parts.length) continue;
            const params: Record<string, string> = {};
            let hit = true;
            let lits = 0;
            for (let i = 0; i < r.segments.length && hit; i++) {
                const seg = r.segments[i]!;
                const part = parts[i]!;
                if ("lit" in seg) {
                    hit = seg.lit === part;
                    lits++;
                } else if (part === "") hit = false;
                else {
                    try {
                        params[seg.param] = decodeURIComponent(part);
                    } catch {
                        hit = false;
                    }
                }
            }
            if (hit && (!best || lits > best.lits)) best = { m: { op: r.op, params }, lits };
        }
        return best?.m ?? null;
    }

    // Whether any op answers this path with some method (a 405 would be nicer, but the contract's unknown is 404;
    // this is used by the preflight to know the path is real).
    knowsPath(pathname: string): boolean {
        return ["GET", "POST", "PUT", "PATCH", "DELETE"].some((m) => this.match(m, pathname) !== null);
    }

    // The ops the chat model may call (free and ask), in definition order.
    aiOps(): Op[] {
        return this.ops.filter((o) => o.tier !== "hidden");
    }

    // The ops listed as MCP tools.
    mcpOps(): Op[] {
        return this.ops.filter((o) => o.mcp && o.tier !== "hidden");
    }
}
