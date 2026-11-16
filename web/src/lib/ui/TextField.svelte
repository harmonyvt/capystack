<script lang="ts">
	type Props = {
		label: string;
		value: string;
		placeholder?: string;
		hint?: string;
		error?: string;
		type?: "text" | "email" | "search";
		multiline?: boolean;
		rows?: number;
		maxlength?: number;
		disabled?: boolean;
		// Keep the label for screen readers only (a composer, a search box).
		hideLabel?: boolean;
		oninput?: (value: string) => void;
		onenter?: () => void;
	};
	let { label, value = $bindable(), placeholder, hint, error, type = "text", multiline = false, rows = 6, maxlength, disabled = false, hideLabel = false, oninput, onenter }: Props = $props();
	const id = $props.id();
</script>

<div class="field" class:invalid={!!error}>
	<label for={id} class:sr={hideLabel}>{label}</label>
	{#if multiline}
		<textarea {id} bind:value {placeholder} {rows} {maxlength} {disabled} aria-invalid={!!error} oninput={() => oninput?.(value)}></textarea>
	{:else}
		<input
			{id}
			{type}
			bind:value
			{placeholder}
			{maxlength}
			{disabled}
			aria-invalid={!!error}
			oninput={() => oninput?.(value)}
			onkeydown={(e) => e.key === "Enter" && onenter?.()}
		/>
	{/if}
	{#if error}<span class="msg err" role="alert">{error}</span>{:else if hint}<span class="msg">{hint}</span>{/if}
</div>

<style>
	.field {
		display: grid;
		gap: var(--space-1);
	}
	label {
		font-size: var(--font-size-caption);
		color: var(--color-text-muted);
		font-weight: var(--font-weight-medium);
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	input,
	textarea {
		width: 100%;
		min-height: 44px;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-raised);
		color: var(--color-text);
		transition: border-color var(--motion-fast);
	}
	textarea {
		resize: vertical;
		line-height: 1.5;
	}
	input:focus,
	textarea:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 25%, transparent);
	}
	.invalid input,
	.invalid textarea {
		border-color: var(--color-danger);
	}
	.msg {
		font-size: var(--font-size-caption);
		color: var(--color-text-muted);
	}
	.err {
		color: var(--color-danger);
	}
</style>
