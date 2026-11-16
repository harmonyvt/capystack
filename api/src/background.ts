// Work that must not hold a response (a PostHog send, a "pull now" push), as in cobalt's api/src/background.ts.
//  - `work` is STARTED here, synchronously.
//  - With a `waitUntil` (the Worker's ctx.waitUntil) it is handed over and this resolves at once; a failure is only a
//    console line, since the answer is already gone.
//  - Without one (tests, the cron) it is awaited, so the order stays what an inline `await` would give.
// Always `await background(...)`: with a waitUntil that costs nothing.
export function background(waitUntil: ((p: Promise<unknown>) => void) | undefined, work: () => Promise<unknown>): Promise<void> {
    let running: Promise<unknown>;
    try {
        running = Promise.resolve(work());
    } catch (e) {
        running = Promise.reject(e);
    }
    const safe = running.then(
        () => undefined,
        (e) => console.error("[background] work failed", e instanceof Error ? `${e.name}: ${e.message}` : String(e)),
    );
    if (!waitUntil) return safe;
    try {
        waitUntil(safe);
    } catch {
        return safe;
    }
    return Promise.resolve();
}

// A timeout we race ourselves: AbortSignal timeouts are not always honoured in the Workers runtime (cobalt lesson).
export async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const t = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms)));
    try {
        return await Promise.race([p, t]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
