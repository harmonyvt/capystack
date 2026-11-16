<script lang="ts">
	import { copy } from "../copy";
	import Button from "./Button.svelte";

	type Props = { title?: string; text?: string; button?: string; busy?: boolean; error?: string; onsignin: () => void };
	let { title = copy.signIn.title, text = copy.signIn.text, button = copy.signIn.button, busy = false, error, onsignin }: Props = $props();
</script>

<section class="card">
	<h1>{title}</h1>
	<p>{text}</p>
	{#if error}<p class="err" role="alert">{error}</p>{/if}
	<Button {busy} onclick={onsignin}>{busy ? copy.signIn.busy : button}</Button>
</section>

<style>
	.card {
		display: grid;
		justify-items: start;
		gap: var(--space-3);
		max-width: 24rem;
		margin: var(--space-8) auto;
		padding: var(--space-6);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface-raised);
	}
	p {
		color: var(--color-text-muted);
	}
	.err {
		color: var(--color-danger);
	}
</style>
