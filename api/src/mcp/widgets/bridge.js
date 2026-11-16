// The MCP Apps bridge, by hand (as cobalt's widgets/bridge.js, trimmed): JSON-RPC 2.0 over window.parent.postMessage.
// View -> host: ui/initialize, ui/notifications/initialized, ui/notifications/size-changed. Host -> view: tool-result,
// host-context-changed, and the requests ping and ui/resource-teardown.
const bridge = (() => {
    const PROTO = "2026-01-26";
    let id = 1;
    const pending = new Map();
    const onResult = [];
    const send = (m) => window.parent.postMessage(Object.assign({ jsonrpc: "2.0" }, m), "*");
    const standalone = window.parent === window;

    function request(method, params, ms) {
        return new Promise((resolve, reject) => {
            const i = id++;
            const t = setTimeout(() => {
                pending.delete(i);
                reject(new Error("no answer from the host"));
            }, ms || 15000);
            pending.set(i, { resolve, reject, t });
            send({ id: i, method, params });
        });
    }

    function setContext(c) {
        const root = document.documentElement;
        if (c && (c.theme === "light" || c.theme === "dark")) root.setAttribute("data-theme", c.theme);
        const vars = c && c.styles && c.styles.variables;
        if (vars) for (const k in vars) if (vars[k] != null && /^--[\w-]+$/.test(k)) root.style.setProperty(k, vars[k]);
    }

    window.addEventListener("message", (e) => {
        if (e.source !== window.parent) return;
        const m = e.data;
        if (!m || m.jsonrpc !== "2.0") return;
        if (m.method) {
            if (m.id !== undefined) send(m.method === "ping" || m.method === "ui/resource-teardown" ? { id: m.id, result: {} } : { id: m.id, error: { code: -32601, message: "method not found" } });
            else if (m.method === "ui/notifications/tool-result") onResult.forEach((f) => f(m.params || {}));
            else if (m.method === "ui/notifications/host-context-changed") setContext(m.params || {});
        } else if (m.id !== undefined && pending.has(m.id)) {
            const p = pending.get(m.id);
            pending.delete(m.id);
            clearTimeout(p.t);
            if (m.error) p.reject(new Error(m.error.message || "request failed"));
            else p.resolve(m.result);
        }
    });

    function watchSize() {
        let last = 0;
        const f = () => {
            const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
            if (h === last) return;
            last = h;
            send({ method: "ui/notifications/size-changed", params: { width: Math.ceil(window.innerWidth), height: h } });
        };
        f();
        new ResizeObserver(f).observe(document.body);
    }

    async function init() {
        // hosts that inject the result at load (window.openai)
        if (window.openai && window.openai.toolOutput) onResult.forEach((f) => f({ structuredContent: window.openai.toolOutput }));
        if (standalone) return;
        try {
            const r = await request("ui/initialize", { appInfo: { name: "capystack", version: "1.0.0" }, appCapabilities: {}, protocolVersion: PROTO });
            setContext((r && r.hostContext) || {});
            send({ method: "ui/notifications/initialized" });
        } catch {
            // no handshake: still draw what arrives
        }
        watchSize();
    }

    return { init, onResult: (f) => onResult.push(f) };
})();
