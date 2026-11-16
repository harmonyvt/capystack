<script lang="ts">
	import type { Snippet } from "svelte";
	import { copy } from "../copy";
	import IconButton from "./IconButton.svelte";

	type Props = { open: boolean; title: string; onclose?: () => void; children: Snippet };
	let { open = $bindable(), title, onclose, children }: Props = $props();
	let dialog: HTMLDialogElement | undefined = $state();

	// The native <dialog> gives the focus trap, Esc and the top layer for free.
	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});

	function close() {
		open = false;
		onclose?.();
	}
</script>

<!-- Esc is handled by the dialog itself (its close event below); a click on the backdrop closes it too. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} aria-label={title} onclose={() => open && close()} onclick={(e) => e.target === dialog && close()}>
	<div class="sheet">
		<header>
			<h2>{title}</h2>
			<IconButton icon="close" label={copy.common.close} onclick={close} />
		</header>
		<div class="body">{@render children()}</div>
	</div>
</dialog>

<style>
	dialog {
		width: min(32rem, 100vw);
		max-height: 90dvh;
		margin: auto;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface-raised);
		color: var(--color-text);
		overflow: hidden;
	}
	dialog[open] {
		animation: rise var(--motion-base) ease-out;
	}
	dialog::backdrop {
		background: color-mix(in srgb, var(--color-text) 40%, transparent);
	}
	/* narrow screens: a sheet that rises from the bottom edge */
	@media (max-width: 40rem) {
		dialog {
			margin: auto 0 0;
			width: 100vw;
			border-bottom-left-radius: 0;
			border-bottom-right-radius: 0;
		}
	}
	.sheet {
		display: flex;
		flex-direction: column;
		max-height: 90dvh;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-3) var(--space-3) var(--space-5);
	}
	.body {
		padding: 0 var(--space-5) var(--space-6);
		overflow: auto;
		display: grid;
		gap: var(--space-4);
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(var(--space-4));
		}
	}
</style>
