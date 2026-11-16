<script lang="ts" module>
	// 24x24 stroke icons (no dependency). Add a name here to use it in IconButton.
	export const icons = {
		plus: "M12 5v14M5 12h14",
		close: "M6 6l12 12M18 6L6 18",
		trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
		note: "M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6",
		chat: "M4 5h16v11H9l-5 4z",
		settings: "M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6",
		send: "M4 12l16-8-6 16-3-7z",
		copy: "M9 9h11v11H9zM5 15V5h10",
		check: "M5 12.5l4.5 4.5L19 7.5",
		key: "M14 10a4 4 0 1 1-3 3.8L4 21v-3l2-1v-2l2-1 3-3",
		device: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2",
		logout: "M10 4H5v16h5M15 8l4 4-4 4M19 12H9",
		back: "M15 5l-7 7 7 7",
		cloud: "M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9.5 4 4 0 0 1 17 18z",
	} as const;
	export type IconName = keyof typeof icons;
</script>

<script lang="ts">
	let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
	<path d={icons[name]} />
</svg>
