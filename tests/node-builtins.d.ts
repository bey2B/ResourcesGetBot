/**
 * 测试专用的 Node 内置模块类型声明。
 * 项目 tsconfig 的 types 只包含 @cloudflare/workers-types（Worker 运行时本来也没有 node 内置模块），
 * 但单测跑在 Node 22 上，需要 node:sqlite / node:fs 来建真实内存库，这里只声明用到的部分。
 */

declare module 'node:sqlite' {
  export interface StatementSyncHandle {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSyncHandle;
  }
}

declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

/** 测试里用 import.meta.url 定位 schema.sql，项目 tsconfig 未启用 import.meta 的完整 lib。 */
interface ImportMeta {
  readonly url: string;
}
