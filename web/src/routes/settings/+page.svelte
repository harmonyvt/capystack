<script lang="ts">
	import { onMount } from "svelte";
	import { copy } from "$lib/copy";
	import { API_URL, ApiError, api, clearToken, web, type SessionInfo } from "$lib/client/api";
	import { markSignedOut } from "$lib/client/auth.svelte";
	import { ago } from "$lib/client/format";
	import { resetNotes } from "$lib/client/notes.svelte";
	import { store } from "$lib/client/storage";
	import { toast } from "$lib/client/toast.svelte";
	import { Button, EmptyState, Icon, IconButton, ListRow, Sheet, Skeleton, TextField } from "$lib/ui";

	type KeyInfo = { id: string; name: string; created_at: number; last_used_at: number | null };

	let sessions = $state<SessionInfo[] | null>(null);
	let currentId = $state<string | null>(null);
	let keys = $state<KeyInfo[] | null>(null);

	let sheet = $state(false);
	let name = $state("");
	let creating = $state(false);
	let nameError = $state<string | undefined>();
	let secret = $state<string | null>(null); // the token, once

	onMount(() => {
		void loadSessions();
		void loadKeys();
	});

	async function loadSessions() {
		try {
			const [list, me] = await Promise.all([api<{ sessions: SessionInfo[] }>("/auth/sessions"), api<{ session: SessionInfo }>("/auth/me")]);
			sessions = list.sessions;
			currentId = me.session.id;
		} catch {
			sessions = [];
			toast(copy.common.error, "error");
		}
	}

	async function loadKeys() {
		try {
			keys = (await web<{ keys: KeyInfo[] }>("/api/keys")).keys;
		} catch {
			keys = [];
			toast(copy.common.error, "error");
		}
	}

	async function revokeSession(id: string) {
		try {
			await api(`/auth/sessions/${id}`, { method: "DELETE" });
			sessions = sessions?.filter((s) => s.id !== id) ?? null;
			toast(copy.settings.sessions.revoked, "success");
		} catch {
			toast(copy.common.error, "error");
		}
	}

	function newKey() {
		name = "";
		secret = null;
		nameError = undefined;
		sheet = true;
	}

	async function createKey() {
		if (!name.trim() || creating) return;
		creating = true;
		nameError = undefined;
		try {
			const r = await web<{ key: KeyInfo; token: string }>("/api/keys", { method: "POST", body: { name: name.trim() } });
			keys = [r.key, ...(keys ?? [])];
			secret = r.token;
			toast(copy.settings.keys.created, "success");
		} catch (e) {
			nameError = e instanceof ApiError && e.code === "keys.too_many" ? copy.settings.keys.tooMany : copy.common.error;
		} finally {
			creating = false;
		}
	}

	async function revokeKey(id: string) {
		try {
			await web(`/api/keys/${id}`, { method: "DELETE" });
			keys = keys?.filter((k) => k.id !== id) ?? null;
			toast(copy.settings.keys.revoked, "success");
		} catch {
			toast(copy.common.error, "error");
		}
	}

	async function copyText(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast(copy.common.copied, "success", 1500);
		} catch {
			toast(copy.common.error, "error");
		}
	}

	async function signOut() {
		try {
			await api("/auth/signout", { method: "POST" });
		} catch {
			/* the session may already be gone: still sign this browser out */
		}
		clearToken();
		resetNotes();
		store.clear();
		markSignedOut();
		toast(copy.settings.account.signedOut);
	}

	const mcpUrl = `${API_URL}/mcp`;
	const claudeCode = `claude mcp add --transport http capystack ${mcpUrl} --header "Authorization: Bearer <your key>"`;
	const generic = JSON.stringify({ mcpServers: { capystack: { type: "http", url: mcpUrl, headers: { Authorization: "Bearer <your key>" } } } }, null, 2);
</script>

<svelte:head>
	<title>{copy.settings.title} · {copy.app}</title>
</svelte:head>

<div class="page">
	<h1>{copy.settings.title}</h1>

	<section>
		<h2>{copy.settings.sessions.title}</h2>
		<p class="hint">{copy.settings.sessions.hint}</p>
		{#if sessions === null}
			<Skeleton height="56px" /><Skeleton height="56px" />
		{:else if sessions.length === 0}
			<EmptyState icon="device" title={copy.settings.sessions.empty} />
		{:else}
			<ul>
				{#each sessions as s (s.id)}
					<li>
						<ListRow
							title={s.device ?? s.name}
							subtitle={s.id === currentId ? `${copy.settings.sessions.current}, ${s.platform ?? ""}` : `${s.platform ?? ""}, ${copy.settings.sessions.lastUsed(ago(s.last_used_at))}`}
						>
							{#snippet leading()}<Icon name="device" />{/snippet}
							{#snippet trailing()}
								{#if s.id !== currentId}
									<IconButton icon="logout" label={copy.settings.sessions.revoke} variant="danger" onclick={() => revokeSession(s.id)} />
								{/if}
							{/snippet}
						</ListRow>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section>
		<div class="head">
			<div>
				<h2>{copy.settings.keys.title}</h2>
				<p class="hint">{copy.settings.keys.hint}</p>
			</div>
			<IconButton icon="plus" label={copy.settings.keys.new} variant="primary" onclick={newKey} />
		</div>
		{#if keys === null}
			<Skeleton height="56px" />
		{:else if keys.length === 0}
			<EmptyState icon="key" title={copy.settings.keys.empty} />
		{:else}
			<ul>
				{#each keys as k (k.id)}
					<li>
						<ListRow title={k.name} subtitle={k.last_used_at ? copy.settings.sessions.lastUsed(ago(k.last_used_at)) : copy.settings.keys.never}>
							{#snippet trailing()}
								<IconButton icon="trash" label={copy.settings.keys.revoke} variant="danger" onclick={() => revokeKey(k.id)} />
							{/snippet}
						</ListRow>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section>
		<h2>{copy.settings.mcp.title}</h2>
		<p class="hint">{copy.settings.mcp.hint}</p>
		<h3>{copy.settings.mcp.claudeCode}</h3>
		<div class="code"><pre>{claudeCode}</pre><IconButton icon="copy" label={copy.common.copy} onclick={() => copyText(claudeCode)} /></div>
		<h3>{copy.settings.mcp.generic}</h3>
		<div class="code"><pre>{generic}</pre><IconButton icon="copy" label={copy.common.copy} onclick={() => copyText(generic)} /></div>
	</section>

	<section>
		<h2>{copy.settings.account.title}</h2>
		<div><Button variant="danger" onclick={signOut}>{copy.settings.account.signOut}</Button></div>
		<p class="hint">{copy.settings.versionLine(copy.app)}</p>
	</section>
</div>

<Sheet bind:open={sheet} title={copy.settings.keys.new}>
	{#if secret}
		<p class="hint">{copy.settings.keys.shownOnce}</p>
		<div class="code"><pre>{secret}</pre><IconButton icon="copy" label={copy.common.copy} onclick={() => copyText(secret ?? "")} /></div>
	{:else}
		<TextField label={copy.settings.keys.nameLabel} bind:value={name} placeholder={copy.settings.keys.namePlaceholder} maxlength={40} error={nameError} onenter={createKey} />
		<div><Button busy={creating} disabled={!name.trim()} onclick={createKey}>{copy.settings.keys.create}</Button></div>
	{/if}
</Sheet>

<style>
	.page {
		display: grid;
		gap: var(--space-7);
		max-width: 40rem;
		padding: var(--space-6) var(--space-4) var(--space-8);
	}
	section {
		display: grid;
		gap: var(--space-3);
	}
	.head {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.hint {
		color: var(--color-text-muted);
		font-size: var(--font-size-caption);
	}
	h3 {
		font-size: var(--font-size-body);
		font-weight: var(--font-weight-medium);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-1);
	}
	.code {
		display: flex;
		align-items: start;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}
	pre {
		flex: 1;
		margin: 0;
		overflow-x: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
