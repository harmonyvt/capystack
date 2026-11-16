// A D1Database look-alike on Node's real SQLite (node:sqlite), as cobalt's test-support/d1-sqlite.ts + test/d1-batch.ts:
// the tests run the real SQL (triggers, RETURNING, ON CONFLICT) against the real migrations in ../d1/migrations. Only the
// surface the Worker uses: prepare().bind().{run, all, first} and batch() (one transaction, as D1 guarantees).
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../d1/migrations/", import.meta.url));
export const ALL_MIGRATIONS_SQL = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(MIGRATIONS_DIR + f, "utf8"))
    .join("\n");

export type FakeD1 = D1Database & { raw: DatabaseSync; breakIt(): void };

type Stmt = {
    sql: string;
    bind(...p: unknown[]): Stmt;
    run(): Promise<{ success: true; results: []; meta: { changes: number } }>;
    all<T = Record<string, unknown>>(): Promise<{ success: true; results: T[]; meta: { changes: number } }>;
    first<T = Record<string, unknown>>(col?: string): Promise<T | null>;
};

export function createD1(sql: string = ALL_MIGRATIONS_SQL): FakeD1 {
    const raw = new DatabaseSync(":memory:");
    raw.exec(sql);
    let broken = false;
    const guard = () => {
        if (broken) throw new Error("D1_ERROR: simulated outage");
    };
    const norm = (p: unknown[]) => p.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v)) as SQLInputValue[];
    const plain = (r: object) => {
        const o: Record<string, unknown> = { ...r };
        for (const k in o) if (typeof o[k] === "bigint") o[k] = Number(o[k]);
        return o;
    };
    const statement = (sql: string, params: unknown[] = []): Stmt => ({
        sql,
        bind: (...p: unknown[]) => statement(sql, p),
        async run() {
            guard();
            const st = raw.prepare(sql);
            // a write with RETURNING still has to be stepped through
            if (/\bRETURNING\b/i.test(sql)) {
                const before = Number((raw.prepare("SELECT total_changes() AS n").get() as { n: number }).n);
                st.all(...norm(params));
                const after = Number((raw.prepare("SELECT total_changes() AS n").get() as { n: number }).n);
                return { success: true, results: [], meta: { changes: after - before } };
            }
            const r = st.run(...norm(params));
            return { success: true, results: [], meta: { changes: Number(r.changes) } };
        },
        async all<T>() {
            guard();
            const rows = raw.prepare(sql).all(...norm(params)).map(plain) as T[];
            return { success: true, results: rows, meta: { changes: 0 } };
        },
        async first<T>(col?: string) {
            guard();
            const st = raw.prepare(sql);
            // a write with RETURNING runs completely even when only its first row is read
            const rows = /\bRETURNING\b/i.test(sql) ? st.all(...norm(params)) : [st.get(...norm(params))].filter(Boolean);
            const row = rows[0] as object | undefined;
            if (!row) return null;
            const p = plain(row);
            return (col ? p[col] : p) as T;
        },
    });
    const answersRows = (sql: string) => /^\s*(?:SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
    return {
        raw,
        breakIt() {
            broken = true;
        },
        prepare: (sql: string) => statement(sql),
        async batch(statements: Stmt[]) {
            guard();
            raw.exec("BEGIN");
            const out = [];
            try {
                for (const s of statements) out.push(answersRows(s.sql) ? await s.all() : await s.run());
                raw.exec("COMMIT");
            } catch (e) {
                raw.exec("ROLLBACK");
                throw e;
            }
            return out;
        },
    } as unknown as FakeD1;
}
