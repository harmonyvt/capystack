export type ToastKind = "info" | "success" | "error";
export type ToastItem = { id: number; text: string; kind: ToastKind };

let next = 1;
export const toasts = $state<{ items: ToastItem[] }>({ items: [] });

export function toast(text: string, kind: ToastKind = "info", ms = 3500) {
	const id = next++;
	toasts.items.push({ id, text, kind });
	if (toasts.items.length > 3) toasts.items.shift();
	setTimeout(() => dismiss(id), ms);
}

export function dismiss(id: number) {
	const i = toasts.items.findIndex((t) => t.id === id);
	if (i >= 0) toasts.items.splice(i, 1);
}
