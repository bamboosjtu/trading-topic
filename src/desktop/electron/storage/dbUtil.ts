import BetterSqlite3 from "better-sqlite3";

export type SqlParameter = string | number | bigint | Buffer | null;

export function rows<T>(
  database: BetterSqlite3.Database,
  sql: string,
  parameters: SqlParameter[] = [],
): T[] {
  return database.prepare(sql).all(...parameters) as T[];
}

/** 生成 `INSERT [OR REPLACE] INTO table(cols) VALUES (?, ...)` 语句。 */
export function buildInsertSql(
  table: string,
  columns: readonly string[],
  orReplace = false,
): string {
  const conflict = orReplace ? "OR REPLACE " : "";
  return `INSERT ${conflict}INTO ${table}(${columns.join(", ")}) VALUES (${columns
    .map(() => "?")
    .join(", ")})`;
}
