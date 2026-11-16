<script lang="ts">
	// A placeholder block instead of a spinner. `lines` > 1 stacks text-height lines, the last one shorter.
	type Props = { width?: string; height?: string; lines?: number; round?: boolean };
	let { width = "100%", height = "1em", lines = 1, round = false }: Props = $props();
</script>

{#if lines > 1}
	<div class="stack" aria-hidden="true">
		{#each Array.from({ length: lines }, (_, i) => i) as i (i)}
			<span class="sk" style:width={i === lines - 1 ? "60%" : width} style:height></span>
		{/each}
	</div>
{:else}
	<span class="sk" class:round style:width style:height aria-hidden="true"></span>
{/if}

<style>
	.sk {
		display: block;
		border-radius: var(--radius-sm);
		background: linear-gradient(90deg, var(--color-surface) 0%, var(--color-border) 50%, var(--color-surface) 100%);
		background-size: 200% 100%;
		animation: shimmer 1.4s ease-in-out infinite;
	}
	.round {
		border-radius: var(--radius-pill);
	}
	.stack {
		display: grid;
		gap: var(--space-2);
	}
	@keyframes shimmer {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}
</style>
