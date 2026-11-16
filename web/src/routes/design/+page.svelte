<script lang="ts">
	import { copy } from "$lib/copy";
	import { toast } from "$lib/client/toast.svelte";
	import { icons, type IconName } from "$lib/ui/Icon.svelte";
	import { Button, EmptyState, Icon, IconButton, ListRow, Sheet, SignInCard, Skeleton, TextField } from "$lib/ui";

	const colors = ["bg", "surface", "surface-raised", "text", "text-muted", "border", "accent", "accent-text", "danger", "success"];
	const spaces = [1, 2, 3, 4, 5, 6, 7, 8];
	const radii = ["sm", "md", "lg", "pill"];
	const sizes = ["caption", "body", "headline", "title", "large"];
	const motions = ["fast", "base", "slow"];
	const iconNames = Object.keys(icons) as IconName[];

	let sheet = $state(false);
	let field = $state("");
	let multi = $state("a longer note\nover two lines");
	let moved = $state(false);
	let theme = $state<"system" | "light" | "dark">("system");

	function setTheme(t: typeof theme) {
		theme = t;
		if (t === "system") document.documentElement.removeAttribute("data-theme");
		else document.documentElement.dataset.theme = t;
	}
</script>

<svelte:head>
	<title>{copy.design.title} · {copy.app}</title>
</svelte:head>

<div class="page">
	<header>
		<div>
			<h1>{copy.design.title}</h1>
			<p class="muted">{copy.design.hint}</p>
		</div>
		<div class="row" role="group" aria-label="theme">
			{#each ["system", "light", "dark"] as const as t (t)}
				<Button variant={theme === t ? "primary" : "secondary"} onclick={() => setTheme(t)}>{t}</Button>
			{/each}
		</div>
	</header>

	<section>
		<h2>color</h2>
		<div class="grid colors">
			{#each colors as c (c)}
				<div class="sw"><span class="chip" style:background="var(--color-{c})"></span><code>--color-{c}</code></div>
			{/each}
		</div>
	</section>

	<section>
		<h2>space</h2>
		{#each spaces as s (s)}
			<div class="bar"><span style:width="var(--space-{s})"></span><code>--space-{s}</code></div>
		{/each}
	</section>

	<section>
		<h2>radius</h2>
		<div class="grid">
			{#each radii as r (r)}
				<div class="sw"><span class="chip box" style:border-radius="var(--radius-{r})"></span><code>--radius-{r}</code></div>
			{/each}
		</div>
	</section>

	<section>
		<h2>type</h2>
		{#each sizes as s (s)}
			<p style:font-size="var(--font-size-{s})" style:font-weight="var(--font-weight-{s})">{s} <code>--font-size-{s}</code></p>
		{/each}
		<p><code>--font-family-mono</code> <code>sample text</code></p>
	</section>

	<section>
		<h2>motion</h2>
		<div class="row">
			<Button variant="secondary" onclick={() => (moved = !moved)}>play</Button>
		</div>
		{#each motions as m (m)}
			<div class="track"><span class="dot" class:moved style:transition="transform var(--motion-{m}) ease-out"></span><code>--motion-{m}</code></div>
		{/each}
	</section>

	<section>
		<h2>Button</h2>
		<div class="row">
			<Button>primary</Button>
			<Button variant="secondary">secondary</Button>
			<Button variant="ghost">ghost</Button>
			<Button variant="danger">danger</Button>
			<Button disabled>disabled</Button>
			<Button busy>busy</Button>
		</div>
	</section>

	<section>
		<h2>IconButton</h2>
		<div class="row">
			{#each iconNames as n (n)}
				<IconButton icon={n} label={n} variant="secondary" />
			{/each}
			<IconButton icon="plus" label="primary" variant="primary" />
			<IconButton icon="trash" label="danger" variant="danger" />
		</div>
		<p class="muted">the name shows on hover and keyboard focus.</p>
	</section>

	<section>
		<h2>TextField</h2>
		<div class="stack">
			<TextField label="name" bind:value={field} placeholder="a short name" hint="up to 40 characters" />
			<TextField label="with an error" bind:value={field} error="that name is taken" />
			<TextField label="note" bind:value={multi} multiline rows={3} />
			<TextField label="disabled" value="can not edit" disabled />
		</div>
	</section>

	<section>
		<h2>ListRow</h2>
		<ul>
			<li><ListRow title="a plain row" subtitle="with a subtitle" /></li>
			<li><ListRow title="a tappable row" subtitle="selected" selected onclick={() => toast("row tapped")} /></li>
			<li>
				<ListRow title="with icons" subtitle="leading and trailing">
					{#snippet leading()}<Icon name="note" />{/snippet}
					{#snippet trailing()}<IconButton icon="trash" label="delete" variant="danger" />{/snippet}
				</ListRow>
			</li>
		</ul>
	</section>

	<section>
		<h2>EmptyState</h2>
		<div class="frame">
			<EmptyState icon="note" title="nothing here yet" hint="a friendly line about what to do next.">
				<Button>do the thing</Button>
			</EmptyState>
		</div>
	</section>

	<section>
		<h2>Skeleton</h2>
		<div class="stack">
			<Skeleton height="1.2em" width="40%" />
			<Skeleton lines={3} />
			<Skeleton width="48px" height="48px" round />
		</div>
	</section>

	<section>
		<h2>Toast</h2>
		<div class="row">
			<Button variant="secondary" onclick={() => toast("something happened")}>info</Button>
			<Button variant="secondary" onclick={() => toast("it worked", "success")}>success</Button>
			<Button variant="secondary" onclick={() => toast("it did not work", "error")}>error</Button>
		</div>
	</section>

	<section>
		<h2>Sheet</h2>
		<div class="row"><Button variant="secondary" onclick={() => (sheet = true)}>open a sheet</Button></div>
	</section>

	<section>
		<h2>SignInCard</h2>
		<div class="frame"><SignInCard onsignin={() => toast("sign in tapped")} /></div>
	</section>
</div>

<Sheet bind:open={sheet} title="a sheet">
	<p>content goes here. the close button sits top right; escape and a tap outside close it too.</p>
	<div><Button onclick={() => (sheet = false)}>done</Button></div>
</Sheet>

<style>
	.page {
		display: grid;
		gap: var(--space-7);
		max-width: 52rem;
		padding: var(--space-6) var(--space-4) var(--space-8);
	}
	header {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		justify-content: space-between;
		align-items: start;
	}
	section {
		display: grid;
		gap: var(--space-3);
	}
	.muted {
		color: var(--color-text-muted);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
	}
	.stack {
		display: grid;
		gap: var(--space-3);
		max-width: 28rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
		gap: var(--space-3);
	}
	.sw {
		display: grid;
		gap: var(--space-2);
	}
	.chip {
		display: block;
		height: 48px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}
	.box {
		height: 64px;
		background: var(--color-accent);
	}
	.bar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.bar span {
		height: var(--space-3);
		background: var(--color-accent);
		border-radius: var(--radius-sm);
	}
	.track {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.dot {
		width: 20px;
		height: 20px;
		border-radius: var(--radius-pill);
		background: var(--color-accent);
	}
	.dot.moved {
		transform: translateX(160px);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-1);
	}
	.frame {
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
	}
</style>
