// The helper's HTTP server: plain node, no packages. Every route but /health needs `x-internal-key` equal to the
// HELPER_KEY env var, which the Worker's Durable Object passes in through envVars (never a client's key). Add routes
// for the work you move here; keep them one job at a time if they are heavy (cobalt runs one ffmpeg encode at a time).
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8080);
const KEY = process.env.HELPER_KEY ?? "";

const same = (a, b) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
};

const send = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
    if (!KEY || !same(String(req.headers["x-internal-key"] ?? ""), KEY)) return send(res, 401, { error: "helper.key" });
    if (req.method === "POST" && req.url === "/echo") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        return send(res, 200, { bytes: Buffer.concat(chunks).length });
    }
    send(res, 404, { error: "not_found" });
}).listen(PORT, () => console.log(`[helper] listening on ${PORT}`));
