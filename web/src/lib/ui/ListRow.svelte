<script lang="ts">
	import type { Snippet } from "svelte";

	type Props = {
		title: string;
		subtitle?: string;
		href?: string;
		selected?: boolean;
		onclick?: (e: MouseEvent) => void;
		leading?: Snippet;
		trailing?: Snippet;
	};
	let { title, subtitle, href, selected = false, onclick, leading, trailing }: Props = $props();
</script>

<div class="row" class:selected>
	{#if href}
		<a class="main" {href} aria-current={selected ? "true" : undefined} {onclick}>
			{#if leading}<span class="lead">{@render leading()}</span>{/if}
			<span class="text"><span class="title">{title}</span>{#if subtitle}<span class="sub">{subtitle}</span>{/if}</span>
		</a>
	{:else if onclick}
		<button class="main" type="button" aria-current={selected ? "true" : undefined} {onclick}>
			{#if leading}<span class="lead">{@render leading()}</span>{/if}
			<span class="text"><span class="title">{title}</span>{#if subtitle}<span class="sub">{subtitle}</span>{/if}</span>
		</button>
	{:else}
		<div class="main">
			{#if leading}<span class="lead">{@render leading()}</span>{/if}
			<span class="text"><span class="title">{title}</span>{#if subtitle}<span class="sub">{subtitle}</span>{/if}</span>
		</div>
	{/if}
	{#if trailing}<div class="trail">{@render trailing()}</div>{/if}
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		border-radius: var(--radius-md);
		transition: background var(--motion-fast);
	}
	.row:hover,
	.row.selected {
		background: var(--color-surface);
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 56px;
		padding: var(--space-2) var(--space-3);
		border: 0;
		background: none;
		color: inherit;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}
	div.main {
		cursor: default;
	}
	.lead {
		display: grid;
		color: var(--color-text-muted);
	}
	.text {
		display: grid;
		min-width: 0;
	}
	.title {
		font-weight: var(--font-weight-medium);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		color: var(--color-text-muted);
		font-size: var(--font-size-caption);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.trail {
		padding-right: var(--space-2);
		display: flex;
		align-items: center;
	}
</style>
