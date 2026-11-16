<script lang="ts">
	import type { Snippet } from "svelte";
	import Icon, { type IconName } from "./Icon.svelte";

	type Props = { icon?: IconName; title: string; hint?: string; children?: Snippet };
	let { icon = "note", title, hint, children }: Props = $props();
</script>

<div class="empty">
	<span class="glyph"><Icon name={icon} size={28} /></span>
	<h2>{title}</h2>
	{#if hint}<p>{hint}</p>{/if}
	{#if children}<div class="action">{@render children()}</div>{/if}
</div>

<style>
	.empty {
		display: grid;
		justify-items: center;
		gap: var(--space-2);
		padding: var(--space-8) var(--space-5);
		text-align: center;
	}
	.glyph {
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text-muted);
		margin-bottom: var(--space-2);
	}
	p {
		max-width: 28ch;
		color: var(--color-text-muted);
	}
	.action {
		margin-top: var(--space-3);
	}
</style>
