<script lang="ts">
	import { copy } from "../copy";
	import { dismiss, toasts } from "../client/toast.svelte";
	import IconButton from "./IconButton.svelte";
</script>

<!-- Mount once, in the root layout. `toast("text", "success")` from anywhere shows one. -->
<div class="host" role="status" aria-live="polite">
	{#each toasts.items as t (t.id)}
		<div class="toast {t.kind}">
			<span>{t.text}</span>
			<IconButton icon="close" label={copy.common.close} onclick={() => dismiss(t.id)} />
		</div>
	{/each}
</div>

<style>
	.host {
		position: fixed;
		inset: auto var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom)) var(--space-4);
		display: grid;
		justify-items: center;
		gap: var(--space-2);
		pointer-events: none;
		z-index: 50;
	}
	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		max-width: 28rem;
		padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4);
		border-radius: var(--radius-pill);
		background: var(--color-text);
		color: var(--color-bg);
		box-shadow: 0 var(--space-2) var(--space-6) color-mix(in srgb, var(--color-text) 25%, transparent);
		animation: pop var(--motion-base) ease-out;
	}
	.toast :global(.ib) {
		color: inherit;
	}
	.success {
		border-left: var(--space-1) solid var(--color-success);
	}
	.error {
		border-left: var(--space-1) solid var(--color-danger);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(var(--space-3));
		}
	}
</style>
