/**
 * Minimal TypeScript declarations for the parts of sql.js that Nurture's
 * web database adapter uses. Kept intentionally small — not a full binding.
 */
declare module 'sql.js' {
  export type SqlValue = number | string | Uint8Array | null;
  export type BindParams = SqlValue[] | Record<string, SqlValue>;

  export interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }

  export interface Statement {
    bind(params?: BindParams): boolean;
    step(): boolean;
    getAsObject(): Record<string, SqlValue>;
    free(): boolean;
  }

  export interface Database {
    run(sql: string, params?: BindParams): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    getRowsModified(): number;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: {
      new (data?: Uint8Array | number[]): Database;
    };
  }

  export interface InitSqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>;
}
