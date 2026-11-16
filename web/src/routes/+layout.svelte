<script lang="ts">
	import type { Snippet } from "svelte";
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import "$lib/design/tokens.css";
	import "$lib/ui/base.css";
	import { copy } from "$lib/copy";
	import { auth, initAuth, signIn } from "$lib/client/auth.svelte";
	import { startAnalytics } from "$lib/client/analytics";
	import { IconButton, SignInCard, Toast } from "$lib/ui";

	let { children }: { children: Snippet } = $props();

	onMount(() => {
		initAuth();
		startAnalytics();
	});

	const tabs = [
		{ href: "/", icon: "note", label: copy.nav.notes },
		{ href: "/chat", icon: "chat", label: copy.nav.chat },
		{ href: "/settings", icon: "settings", label: copy.nav.settings },
	] as const;
	const here = (href: string) => (href === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(href));
</script>

<svelte:head>
	<title>{copy.app}</title>
</svelte:head>

<div class="app">
	<nav aria-label="main">
		<span class="brand">{copy.app}</span>
		{#each tabs as t (t.href)}
			<IconButton href={t.href} icon={t.icon} label={t.label} current={here(t.href)} />
		{/each}
	</nav>
	<main>
		{#if auth.state === "out"}
			<SignInCard busy={auth.busy} error={auth.failed ? copy.signIn.failed : undefined} onsignin={() => (auth.failed ? location.reload() : signIn())} />
		{:else}
			{@render children()}
		{/if}
	</main>
</div>
<Toast />

<style>
	.app {
		display: grid;
		grid-template-columns: auto 1fr;
		min-height: 100dvh;
	}
	nav {
		position: sticky;
		top: 0;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-2);
		border-right: 1px solid var(--color-border);
		background: var(--color-surface);
	}
	.brand {
		writing-mode: vertical-rl;
		transform: rotate(180deg);
		margin-bottom: var(--space-4);
		color: var(--color-text-muted);
		font-weight: var(--font-weight-semibold);
		letter-spacing: 0.04em;
	}
	main {
		min-width: 0;
	}
	/* phones: the tabs sit at the bottom edge, within reach of a thumb */
	@media (max-width: 40rem) {
		.app {
			grid-template-columns: 1fr;
			padding-bottom: calc(64px + env(safe-area-inset-bottom));
		}
		nav {
			position: fixed;
			inset: auto 0 0 0;
			height: auto;
			flex-direction: row;
			justify-content: space-around;
			padding: var(--space-2) var(--space-2) calc(var(--space-2) + env(safe-area-inset-bottom));
			border-right: 0;
			border-top: 1px solid var(--color-border);
			z-index: 20;
		}
		.brand {
			display: none;
		}
	}
</style>
