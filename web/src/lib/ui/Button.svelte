<script lang="ts">
	import type { Snippet } from "svelte";

	type Props = {
		variant?: "primary" | "secondary" | "ghost" | "danger";
		type?: "button" | "submit";
		disabled?: boolean;
		busy?: boolean;
		href?: string;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	};
	let { variant = "primary", type = "button", disabled = false, busy = false, href, onclick, children }: Props = $props();
</script>

{#if href}
	<a class="btn {variant}" {href} {onclick}>{@render children()}</a>
{:else}
	<button class="btn {variant}" {type} disabled={disabled || busy} aria-busy={busy} {onclick}>{@render children()}</button>
{/if}

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 44px;
		padding: 0 var(--space-5);
		border: 1px solid transparent;
		border-radius: var(--radius-pill);
		font-weight: var(--font-weight-semibold);
		font-size: var(--font-size-body);
		text-decoration: none;
		cursor: pointer;
		transition:
			background var(--motion-fast),
			opacity var(--motion-fast),
			transform var(--motion-fast);
	}
	.btn:active:not(:disabled) {
		transform: scale(0.97);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn[aria-busy="true"] {
		opacity: 0.7;
	}
	.primary {
		background: var(--color-accent);
		color: var(--color-accent-text);
	}
	.secondary {
		background: var(--color-surface-raised);
		border-color: var(--color-border);
		color: var(--color-text);
	}
	.ghost {
		background: transparent;
		color: var(--color-accent);
	}
	.ghost:hover:not(:disabled),
	.secondary:hover:not(:disabled) {
		background: var(--color-surface);
	}
	.danger {
		background: transparent;
		border-color: var(--color-danger);
		color: var(--color-danger);
	}
	.danger:hover:not(:disabled) {
		background: var(--color-danger);
		color: var(--color-accent-text);
	}
</style>
