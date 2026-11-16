<script lang="ts">
	import { untrack } from "svelte";
	import { copy } from "$lib/copy";
	import { type Note, updateNote } from "$lib/client/notes.svelte";
	import { IconButton, TextField } from "$lib/ui";

	type Props = { note: Note; onback: () => void; ondelete: () => void };
	let { note, onback, ondelete }: Props = $props();

	// The editor is keyed by note id in the page, so reading the note once is intended: after that the fields are the
	// source of truth and every keystroke goes to the store (optimistic, queued, debounced to the network).
	let title = $state(untrack(() => note.title));
	let body = $state(untrack(() => note.body));
	const id = untrack(() => note.id);
</script>

<section class="editor">
	<header>
		<span class="back"><IconButton icon="back" label={copy.notes.back} onclick={onback} /></span>
		<span class="grow"></span>
		<IconButton icon="trash" label={copy.notes.delete} variant="danger" onclick={ondelete} />
	</header>
	<TextField label={copy.notes.titleLabel} bind:value={title} placeholder={copy.notes.titlePlaceholder} maxlength={200} oninput={(v) => updateNote(id, { title: v })} />
	<TextField label={copy.notes.bodyLabel} bind:value={body} placeholder={copy.notes.bodyPlaceholder} multiline rows={14} oninput={(v) => updateNote(id, { body: v })} />
</section>

<style>
	.editor {
		display: grid;
		align-content: start;
		gap: var(--space-4);
		padding: var(--space-4);
	}
	header {
		display: flex;
		align-items: center;
	}
	.grow {
		flex: 1;
	}
	.back {
		display: none;
	}
	@media (max-width: 40rem) {
		.back {
			display: block;
		}
	}
</style>
