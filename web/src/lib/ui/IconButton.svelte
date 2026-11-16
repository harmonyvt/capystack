<script lang="ts">
	import Icon, { type IconName } from "./Icon.svelte";

	type Props = {
		icon: IconName;
		// The name: the accessible label, and the tooltip on hover or keyboard focus.
		label: string;
		variant?: "primary" | "secondary" | "ghost" | "danger";
		disabled?: boolean;
		href?: string;
		current?: boolean;
		onclick?: (e: MouseEvent) => void;
	};
	let { icon, label, variant = "ghost", disabled = false, href, current = false, onclick }: Props = $props();
</script>

{#if href}
	<a class="ib {variant}" {href} aria-label={label} aria-current={current ? "page" : undefined} {onclick}>
		<Icon name={icon} />
		<span class="tip" aria-hidden="true">{label}</span>
	</a>
{:else}
	<button class="ib {variant}" type="button" aria-label={label} {disabled} {onclick}>
		<Icon name={icon} />
		<span class="tip" aria-hidden="true">{label}</span>
	</button>
{/if}

<style>
	.ib {
		position: relative;
		display: inline-grid;
		place-items: center;
		width: 44px;
		height: 44px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		text-decoration: none;
		transition:
			background var(--motion-fast),
			color var(--motion-fast),
			transform var(--motion-fast);
	}
	.ib:hover:not(:disabled),
	.ib[aria-current="page"] {
		background: var(--color-surface);
		color: var(--color-text);
	}
	.ib[aria-current="page"] {
		color: var(--color-accent);
	}
	.ib:active:not(:disabled) {
		transform: scale(0.94);
	}
	.ib:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.primary {
		background: var(--color-accent);
		color: var(--color-accent-text);
	}
	.primary:hover:not(:disabled) {
		background: var(--color-accent);
		color: var(--color-accent-text);
		opacity: 0.9;
	}
	.secondary {
		background: var(--color-surface-raised);
		border-color: var(--color-border);
		color: var(--color-text);
	}
	.danger {
		color: var(--color-danger);
	}
	.tip {
		position: absolute;
		top: calc(100% + var(--space-1));
		left: 50%;
		transform: translateX(-50%);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--color-text);
		color: var(--color-bg);
		font-size: var(--font-size-caption);
		white-space: nowrap;
		pointer-events: none;
		opacity: 0;
		transition: opacity var(--motion-fast);
		z-index: 5;
	}
	@media (hover: hover) {
		.ib:hover .tip,
		.ib:focus-visible .tip {
			opacity: 1;
			transition-delay: 0.4s;
		}
	}
</style>
