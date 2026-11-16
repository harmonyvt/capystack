<script lang="ts">
	import { onMount, tick } from "svelte";
	import { copy } from "$lib/copy";
	import { ApiError } from "$lib/client/api";
	import { createThread, getThread, listThreads, messageText, sendMessage, threadTitle, type Message, type Thread } from "$lib/client/chat";
	import { ago } from "$lib/client/format";
	import { store } from "$lib/client/storage";
	import { toast } from "$lib/client/toast.svelte";
	import { EmptyState, IconButton, ListRow, Skeleton, TextField } from "$lib/ui";

	let threads = $state<Thread[]>([]);
	let loaded = $state(false);
	let activeId = $state<string | null>(null);
	let open = $state(false); // phones: the conversation covers the list
	let messages = $state<Message[]>([]);
	let loadingThread = $state(false);
	let text = $state("");
	let sending = $state(false);
	let log: HTMLElement | undefined = $state();

	const shown = $derived(messages.map((m) => ({ m, text: messageText(m) })).filter((x) => x.text));

	onMount(() => {
		threads = store.get<Thread[]>("threads", []); // the list is there before the request lands
		loaded = true;
		void refresh();
	});

	async function refresh() {
		try {
			threads = (await listThreads()).sort((a, b) => b.updated_at - a.updated_at);
			store.set("threads", threads);
		} catch (e) {
			if (!(e instanceof ApiError && e.isNetwork)) toast(copy.common.error, "error");
		}
	}

	async function scroll() {
		await tick();
		log?.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
	}

	async function openThread(id: string) {
		activeId = id;
		open = true;
		messages = [];
		loadingThread = true;
		try {
			const r = await getThread(id);
			if (activeId === id) messages = r.messages;
		} catch {
			toast(copy.common.error, "error");
		} finally {
			loadingThread = false;
		}
		void scroll();
	}

	function fresh() {
		activeId = null;
		messages = [];
		open = true;
	}

	async function send() {
		const body = text.trim();
		if (!body || sending) return;
		sending = true;
		text = "";
		const optimistic: Message = { id: `local-${crypto.randomUUID()}`, role: "user", text: body };
		messages.push(optimistic);
		void scroll();
		try {
			if (!activeId) {
				const t = await createThread(body.slice(0, 40));
				threads.unshift(t);
				activeId = t.id;
			}
			const id = activeId;
			const r = await sendMessage(id, body, crypto.randomUUID());
			if (r.messages?.length) {
				messages = [...messages.filter((m) => m !== optimistic), ...(r.messages.some((m) => m.role === "user") ? [] : [optimistic]), ...r.messages];
			} else {
				messages = (await getThread(id)).messages;
			}
			void refresh();
		} catch (e) {
			messages = messages.filter((m) => m !== optimistic);
			text = body; // give the words back
			toast(e instanceof ApiError && e.code === "ai.off" ? copy.chat.aiOff : copy.chat.failed, "error");
		} finally {
			sending = false;
			void scroll();
		}
	}
</script>

<svelte:head>
	<title>{copy.chat.title} · {copy.app}</title>
</svelte:head>

<div class="split" class:open>
	<aside>
		<header>
			<h1>{copy.chat.title}</h1>
			<IconButton icon="plus" label={copy.chat.new} variant="primary" onclick={fresh} />
		</header>
		{#if !loaded}
			<div class="sk"><Skeleton height="1.1em" width="60%" /><Skeleton height="1.1em" width="45%" /></div>
		{:else if threads.length === 0}
			<EmptyState icon="chat" title={copy.chat.empty.title} hint={copy.chat.empty.hint} />
		{:else}
			<ul>
				{#each threads as t (t.id)}
					<li><ListRow title={threadTitle(t, copy.chat.untitled)} subtitle={ago(t.updated_at)} selected={t.id === activeId} onclick={() => openThread(t.id)} /></li>
				{/each}
			</ul>
		{/if}
	</aside>
	<section class="convo">
		<header class="bar">
			<span class="back"><IconButton icon="back" label={copy.chat.back} onclick={() => (open = false)} /></span>
		</header>
		<div class="log" bind:this={log}>
			{#if loadingThread}
				<Skeleton lines={3} height="1em" />
			{:else if shown.length === 0 && !sending}
				<EmptyState icon="chat" title={copy.chat.emptyThread.title} hint={copy.chat.emptyThread.hint} />
			{:else}
				{#each shown as { m, text: t } (m.id)}
					<div class="msg {m.role === 'user' ? 'me' : 'them'}">
						<span class="who">{m.role === "user" ? copy.chat.you : copy.chat.model}</span>
						<p>{t}</p>
					</div>
				{/each}
				{#if sending}
					<div class="msg them" aria-live="polite"><span class="who">{copy.chat.thinking}</span><Skeleton lines={2} height="0.9em" /></div>
				{/if}
			{/if}
		</div>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				void send();
			}}
		>
			<div class="grow"><TextField label={copy.chat.title} bind:value={text} placeholder={copy.chat.placeholder} hideLabel disabled={sending} onenter={send} /></div>
			<IconButton icon="send" label={copy.chat.send} variant="primary" disabled={sending || !text.trim()} onclick={send} />
		</form>
	</section>
</div>

<style>
	.split {
		display: grid;
		grid-template-columns: minmax(16rem, 22rem) 1fr;
		height: 100dvh;
	}
	aside {
		border-right: 1px solid var(--color-border);
		padding: var(--space-4) var(--space-2);
		display: grid;
		align-content: start;
		gap: var(--space-2);
		overflow: auto;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 var(--space-2) var(--space-2) var(--space-3);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-1);
	}
	.sk {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-3);
	}
	.convo {
		display: grid;
		grid-template-rows: auto 1fr auto;
		min-height: 0;
	}
	.bar {
		padding: var(--space-2);
		min-height: 0;
	}
	.back {
		display: none;
	}
	.log {
		overflow: auto;
		display: grid;
		align-content: start;
		gap: var(--space-4);
		padding: var(--space-4);
	}
	.msg {
		display: grid;
		gap: var(--space-1);
		max-width: 40rem;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}
	.msg.me {
		justify-self: end;
		background: var(--color-accent);
		color: var(--color-accent-text);
	}
	.msg p {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.who {
		font-size: var(--font-size-caption);
		opacity: 0.7;
	}
	form {
		display: flex;
		align-items: end;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4) var(--space-4);
		border-top: 1px solid var(--color-border);
	}
	.grow {
		flex: 1;
	}
	@media (max-width: 40rem) {
		.split {
			grid-template-columns: 1fr;
			height: auto;
		}
		aside {
			border-right: 0;
		}
		.convo {
			display: none;
		}
		.open .convo {
			display: grid;
			position: fixed;
			inset: 0 0 calc(64px + env(safe-area-inset-bottom)) 0;
			background: var(--color-bg);
			z-index: 10;
		}
		.back {
			display: block;
		}
	}
</style>
