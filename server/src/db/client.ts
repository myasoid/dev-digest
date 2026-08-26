import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema } from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * The transaction handle `db.transaction(async (tx) => ...)` passes to its
 * callback — same query-builder surface as `Db` (`.select`/`.insert`/
 * `.update`/`.delete`), scoped to one transaction. Extracted here so a
 * repository method that must run INSIDE a caller's transaction (e.g.
 * deleting an owner row and its `context_doc_links` atomically) can accept
 * either a plain `Db` or a `Tx` without a second copy of the method.
 */
export type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T, ...rest: never[]) => unknown
  ? T
  : never;

/** Either the top-level `Db` or a transaction handle — whatever a query builder call accepts. */
export type Executor = Db | Tx;

export interface DbHandle {
  db: Db;
  sql: postgres.Sql;
  close: () => Promise<void>;
}

/**
 * Create a Drizzle client over postgres-js. Used by the app (one shared handle)
 * and by the Testcontainers harness (per-test handle).
 */
export function createDb(databaseUrl: string, opts?: { max?: number }): DbHandle {
  const sql = postgres(databaseUrl, { max: opts?.max ?? 10 });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
