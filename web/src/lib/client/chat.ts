// Chat threads and messages (contract section 4: chat.*). The server runs the model with the notes ops as tools and
// stores the turn; the page only lists, reads and sends.
import { api } from "./api";

export type Thread = { id: string; title: string | null; created_at: number; updated_at: number };
export type Message = { id: string; role: "user" | "assistant" | string; created_at?: number; text?: string; content?: unknown; content_json?: unknown };

export const listThreads = async () => (await api<{ threads: Thread[] }>("/chat/threads")).threads;
export const createThread = async (title?: string) => (await api<{ thread: Thread }>("/chat/threads", { method: "POST", body: title ? { title } : {} })).thread;
export const getThread = (id: string) => api<{ thread: Thread; messages: Message[] }>(`/chat/threads/${id}`);
export const sendMessage = (id: string, text: string, key: string) =>
	api<{ messages?: Message[] }>(`/chat/threads/${id}/messages`, { method: "POST", body: { text }, idempotencyKey: key });

// What to show for a stored message: its text blocks. Tool calls and tool results (no text) are hidden.
export function messageText(m: Message): string {
	if (typeof m.text === "string") return m.text;
	let c: unknown = m.content ?? m.content_json;
	if (typeof c === "string") {
		try {
			c = JSON.parse(c);
		} catch {
			return c as string;
		}
	}
	if (typeof c === "string") return c;
	if (Array.isArray(c)) {
		return c
			.map((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text" ? String((b as { text?: unknown }).text ?? "") : ""))
			.filter(Boolean)
			.join("\n");
	}
	return "";
}

export const threadTitle = (t: Thread, fallback: string) => (t.title && t.title.trim() ? t.title : fallback);
