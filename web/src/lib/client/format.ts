// "3 min ago", "yesterday", "12 nov" in lowercase.
export function ago(ms: number | null | undefined, now = Date.now()): string {
	if (!ms) return "";
	const s = Math.max(0, Math.round((now - ms) / 1000));
	if (s < 45) return "just now";
	if (s < 3600) return `${Math.round(s / 60)} min ago`;
	if (s < 86400) return `${Math.round(s / 3600)} h ago`;
	if (s < 172800) return "yesterday";
	return new Date(ms).toLocaleDateString("en", { day: "numeric", month: "short" }).toLowerCase();
}
