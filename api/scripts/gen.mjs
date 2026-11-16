// `npm run gen` (docs/CONTRACT.md sections 1 and 4): everything generated from the op registry, checked in.
//  - api/openapi.json: every route (method, path, auth, input, reply shape where the op has one), OpenAPI 3.1.
//  - apple/CapystackKit/Sources/CapystackKit/API/Endpoints.generated.swift: one `Endpoint` per route, named after the op
//    in camelCase (notes.list -> notesList); path params stay as `:id`. The apple lane defines `Endpoint` itself.
// `npm run gen:check` writes nothing and exits 1 when either file is stale (the api gate runs it).
//
// The registry is TypeScript, so esbuild bundles src/registry/index.ts into a temporary module first (as cobalt's
// scripts/run-gen.mjs does); the packages stay external and resolve from node_modules.
import { build } from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const api = resolve(here, "..");
const repo = resolve(api, "..");
export const OPENAPI_PATH = join(api, "openapi.json");
export const SWIFT_PATH = join(repo, "apple/CapystackKit/Sources/CapystackKit/API/Endpoints.generated.swift");

async function loadRegistry() {
    const cache = join(api, "node_modules/.cache");
    mkdirSync(cache, { recursive: true });
    const dir = mkdtempSync(join(cache, "capystack-gen-"));
    const out = join(dir, "registry.mjs");
    try {
        await build({
            entryPoints: [join(api, "src/registry/index.ts")],
            bundle: true,
            platform: "node",
            format: "esm",
            target: "node22",
            outfile: out,
            packages: "external",
            logLevel: "warning",
        });
        const mod = await import(pathToFileURL(out).href);
        const z = await import(pathToFileURL(join(api, "node_modules/zod/index.js")).href).catch(() => import("zod"));
        return { REGISTRY: mod.REGISTRY, z };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// ---- OpenAPI ----------------------------------------------------------------------------------------------------------

const SAFE = 9007199254740991;

function schemaOf(z, schema, components, io) {
    const raw = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any", io });
    const defs = raw.$defs ?? {};
    delete raw.$defs;
    delete raw.$schema;
    const fix = (v) => {
        if (Array.isArray(v)) return v.map(fix);
        if (!v || typeof v !== "object") return v;
        const out = {};
        for (const [k, x] of Object.entries(v)) {
            if (k === "$ref" && typeof x === "string") out[k] = x.replace("#/$defs/", "#/components/schemas/");
            // integers carry JavaScript's safe range by default: noise in a contract
            else if ((k === "minimum" && x === -SAFE) || (k === "maximum" && x === SAFE)) continue;
            else out[k] = fix(x);
        }
        return out;
    };
    for (const [id, def] of Object.entries(defs)) {
        const fixed = fix(def);
        if (components[id] && JSON.stringify(components[id]) !== JSON.stringify(fixed)) throw new Error(`schema ${id} is defined two ways`);
        components[id] = fixed;
    }
    return fix(raw);
}

const AUTH_TEXT = { open: "none", key: "Bearer token: a session or a key for tools", session: "Bearer token of a signed-in device (a key for tools gets 403)" };

function operation(z, op, components) {
    const { method, path } = op.route;
    const params = [...path.matchAll(/:([A-Za-z_]+)/g)].map((m) => m[1]);
    const parameters = params.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } }));
    const out = { operationId: op.name, summary: op.ai?.line ?? op.doc ?? op.name, tags: [op.name.split(".")[0]] };
    const input = schemaOf(z, op.input, components, "input");
    const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
    if (!op.http && input.type === "object" && input.properties && Object.keys(input.properties).length > 0) {
        const props = { ...input.properties };
        for (const p of params) delete props[p];
        const required = (input.required ?? []).filter((r) => !params.includes(r));
        if (hasBody && Object.keys(props).length > 0) {
            out.requestBody = { required: required.length > 0, content: { "application/json": { schema: { ...input, properties: props, required } } } };
        } else if (!hasBody) {
            for (const [name, schema] of Object.entries(props)) parameters.push({ name, in: "query", required: required.includes(name), schema });
        }
    }
    if (parameters.length > 0) out.parameters = parameters;
    out.responses = op.output
        ? { "2XX": { description: "success", content: { "application/json": { schema: schemaOf(z, op.output, components, "output") } } } }
        : { default: { description: op.raw ? "the handler's own response" : "JSON" } };
    out.responses["4XX"] = { description: "error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
    out.security = op.auth === "open" ? [] : [{ bearer: [] }];
    out["x-capystack"] = { auth: op.auth, auth_text: AUTH_TEXT[op.auth], ai: op.tier, ...(op.mcp ? { mcp: op.toolName } : {}) };
    return out;
}

export function openApi(z, REGISTRY) {
    const components = {
        Error: {
            type: "object",
            properties: { error: { type: "string", description: "dotted code, e.g. auth.required" }, message: { type: "string" } },
            required: ["error"],
        },
    };
    const paths = {};
    for (const op of REGISTRY.ops) {
        const p = op.route.path.replace(/:([A-Za-z_]+)/g, "{$1}");
        (paths[p] ??= {})[op.route.method.toLowerCase()] = operation(z, op, components);
    }
    const sortedPaths = Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b)));
    const sortedSchemas = Object.fromEntries(Object.entries(components).sort(([a], [b]) => a.localeCompare(b)));
    return {
        openapi: "3.1.0",
        info: { title: "capystack API", version: "0.1.0", description: "Generated from the op registry by api/scripts/gen.mjs. Do not edit." },
        servers: [{ url: "https://capystack-api.capybaraharmony.com" }],
        paths: sortedPaths,
        components: { schemas: sortedSchemas, securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    };
}

// ---- Swift ------------------------------------------------------------------------------------------------------------

// notes.list -> notesList, system.capabilities -> systemCapabilities, mcp -> mcp
export const swiftName = (op) => op.split(/[._-]/).map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join("");

export function swift(REGISTRY) {
    const lines = REGISTRY.ops.map((op) => {
        const doc = `    /// ${op.route.method} ${op.route.path} (auth: ${op.auth})`;
        return `${doc}\n    public static let ${swiftName(op.name)} = Endpoint(method: "${op.route.method}", path: "${op.route.path}")`;
    });
    return `// GENERATED by api/scripts/gen.mjs from the op registry (api/src/registry/). Do not edit: run \`npm run gen\` in api/.
import Foundation

extension Endpoint {
${lines.join("\n")}
}
`;
}

// ---- main -------------------------------------------------------------------------------------------------------------

export async function outputs() {
    const { REGISTRY, z } = await loadRegistry();
    return { openapi: `${JSON.stringify(openApi(z, REGISTRY), null, 2)}\n`, swift: swift(REGISTRY) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const out = await outputs();
    const files = [
        [OPENAPI_PATH, out.openapi],
        [SWIFT_PATH, out.swift],
    ];
    if (process.argv.includes("--check")) {
        const stale = files.filter(([p, text]) => !existsSync(p) || readFileSync(p, "utf8") !== text).map(([p]) => p);
        if (stale.length > 0) {
            console.error(`stale (run \`npm run gen\`):\n${stale.map((p) => `  ${p}`).join("\n")}`);
            process.exit(1);
        }
        console.log("openapi.json and Endpoints.generated.swift are up to date");
    } else {
        for (const [p, text] of files) {
            mkdirSync(dirname(p), { recursive: true });
            writeFileSync(p, text);
            console.log(`wrote ${p}`);
        }
    }
}
