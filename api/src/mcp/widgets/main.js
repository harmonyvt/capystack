// The notes view: a skeleton until the tool result arrives, then the notes (title, first line, when). Text only, set
// with textContent: a note's words never become HTML.
const root = document.getElementById("root");

const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
};

const ago = (ms) => {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(ms).toLocaleDateString();
};

function skeleton() {
    const card = el("section", "card skeleton");
    card.append(el("div", "head")).firstChild.append(el("h1", "", "notes"));
    const ul = el("ul");
    for (let i = 0; i < 3; i++) ul.append(el("li"));
    card.append(ul);
    root.replaceChildren(card);
}

function draw(data) {
    const notes = (data && Array.isArray(data.notes) ? data.notes : []).slice(0, 50);
    const card = el("section", "card");
    const head = el("div", "head");
    head.append(el("h1", "", "notes"), el("span", "count", notes.length === 1 ? "1 note" : `${notes.length} notes`));
    card.append(head);
    if (notes.length === 0) card.append(el("p", "empty", "no notes yet"));
    else {
        const ul = el("ul");
        for (const n of notes) {
            const li = el("li");
            const first = String(n.body || "").split("\n").find((l) => l.trim() !== "") || "";
            li.append(el("div", "title", n.title || "untitled"));
            if (first) li.append(el("div", "line", first));
            if (typeof n.updated_at === "number") li.append(el("div", "when", ago(n.updated_at)));
            ul.append(li);
        }
        card.append(ul);
    }
    root.replaceChildren(card);
}

skeleton();
bridge.onResult((r) => draw(r.structuredContent || {}));
bridge.init();
