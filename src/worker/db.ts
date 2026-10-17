import type { D1Database, D1Meta, D1Result, D1Value } from "./types";

export async function queryAll<T>(
  db: D1Database,
  sql: string,
  params: D1Value[] = [],
): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params).all<T>();
  return result.results;
}

export async function queryOne<T>(
  db: D1Database,
  sql: string,
  params: D1Value[] = [],
): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}

export async function execute(
  db: D1Database,
  sql: string,
  params: D1Value[] = [],
): Promise<D1Meta> {
  const result: D1Result<never> = await db.prepare(sql).bind(...params).run();
  return result.meta;
}

export async function insert(
  db: D1Database,
  sql: string,
  params: D1Value[] = [],
): Promise<number> {
  const meta = await execute(db, sql, params);
  return meta.last_row_id ?? 0;
}

export async function executeBatch(
  db: D1Database,
  statements: { sql: string; params?: D1Value[] }[],
): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(
    statements.map((statement) => db.prepare(statement.sql).bind(...(statement.params ?? []))),
  );
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}
