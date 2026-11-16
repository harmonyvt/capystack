<script lang="ts">
	import { onMount } from "svelte";
	import { copy } from "$lib/copy";
	import { ago } from "$lib/client/format";
	import { createNote, data, deleteNote, startSync, sync } from "$lib/client/notes.svelte";
	import { toast } from "$lib/client/toast.svelte";
	import NoteEditor from "$lib/NoteEditor.svelte";
	import { EmptyState, IconButton, ListRow, Skeleton } from "$lib/ui";

	let selectedId = $state<string | null>(null);
	const selected = $derived(data.notes.find((n) => n.id === selectedId) ?? null);

	onMount(() => startSync());

	const status = $derived(
		sync.pending > 0 && sync.status !== "syncing"
			? sync.status === "offline"
				? copy.common.offline
				: copy.common.pending(sync.pending)
			: sync.status === "syncing"
				? copy.common.syncing
				: sync.status === "offline"
					? copy.common.offline
					: sync.status === "error"
						? copy.common.error
						: copy.common.synced,
	);

	const firstLine = (s: string) => s.split("\n").find((l) => l.trim())?.trim() ?? "";

	function add() {
		selectedId = createNote().id;
	}
	function remove() {
		if (!selectedId) return;
		deleteNote(selectedId);
		selectedId = null;
		toast(copy.notes.deleted);
	}
</script>

<svelte:head>
	<title>{copy.notes.title} · {copy.app}</title>
</svelte:head>

<div class="split" class:open={!!selected}>
	<aside>
		<header>
			<h1>{copy.notes.title}</h1>
			<span class="status" aria-live="polite">{sync.loaded ? status : ""}</span>
			<IconButton icon="plus" label={copy.notes.new} variant="primary" onclick={add} />
		</header>
		{#if !sync.loaded}
			<div class="skeletons">
				{#each [0, 1, 2, 3, 4] as i (i)}
					<div class="sk-row"><Skeleton height="1.1em" width="55%" /><Skeleton height="0.9em" /></div>
				{/each}
			</div>
		{:else if data.notes.length === 0}
			<EmptyState icon="note" title={copy.notes.empty.title} hint={copy.notes.empty.hint} />
		{:else}
			<ul>
				{#each data.notes as n (n.id)}
					<li><ListRow title={n.title || copy.notes.untitled} subtitle={firstLine(n.body) || ago(n.updated_at)} selected={n.id === selectedId} onclick={() => (selectedId = n.id)} /></li>
				{/each}
			</ul>
		{/if}
	</aside>
	<div class="pane">
		{#if selected}
			{#key selected.id}
				<NoteEditor note={selected} onback={() => (selectedId = null)} ondelete={remove} />
			{/key}
		{:else}
			<EmptyState icon="note" title={copy.notes.pickOne} />
		{/if}
	</div>
</div>

<style>
	.split {
		display: grid;
		grid-template-columns: minmax(16rem, 22rem) 1fr;
		min-height: 100dvh;
	}
	aside {
		border-right: 1px solid var(--color-border);
		padding: var(--space-4) var(--space-2);
		display: grid;
		align-content: start;
		gap: var(--space-2);
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 0 var(--space-2) var(--space-2) var(--space-3);
	}
	.status {
		flex: 1;
		color: var(--color-text-muted);
		font-size: var(--font-size-caption);
		text-align: right;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-1);
	}
	.skeletons {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-3);
	}
	.sk-row {
		display: grid;
		gap: var(--space-2);
	}
	@media (max-width: 40rem) {
		.split {
			grid-template-columns: 1fr;
			min-height: auto;
		}
		aside {
			border-right: 0;
		}
		.pane {
			display: none;
		}
		.open .pane {
			display: block;
			position: fixed;
			inset: 0 0 calc(64px + env(safe-area-inset-bottom)) 0;
			background: var(--color-bg);
			overflow: auto;
			z-index: 10;
		}
	}
</style>
