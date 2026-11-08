/**
 * 广播分批发送的单测：用 Node 22 内置的 node:sqlite 建一个真实内存库，
 * 加载仓库里真实的 src/db/schema.sql，再让 queries.ts / broadcast.ts 直接跑真 SQL。
 *
 * 覆盖四条关键路径：
 * 1. 首批只发 batchSize 个，游标推进、状态回到 pending 等下一轮；
 * 2. 续发从游标继续，不重复发给已处理用户；
 * 3. 最后一批收尾：写终态 sent + broadcast_finished 日志；
 * 4. 陈旧 sending（Worker 被终止）被 Cron 恢复后能继续发。
 */
import { describe, expect, it } from 'vitest';
import type { D1Database, D1Result } from '@cloudflare/workers-types';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  buildBroadcastReport,
  executeBroadcast,
  serializeBroadcastText,
  type BroadcastDeliverer,
} from '../src/handlers/broadcast';
import { createBroadcast, getBroadcast, updateBroadcastStatus } from '../src/db/queries';
import { getBroadcastCursor } from '../src/db/broadcast-batch';
import { runBroadcastCron } from '../src/cron';

interface SqliteHandle {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

interface SqliteStatement {
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

function makeMeta(changes = 0, lastRowId = 0): D1Result<unknown>['meta'] {
  return {
    changes,
    last_row_id: lastRowId,
    duration: 0,
    rows_read: 0,
    rows_written: changes,
    size_after: 0,
    changed_db: false,
  };
}

/** 极简 D1 适配器：把 D1 的 prepare/bind/first/all/run 映射到 node:sqlite。 */
class SqliteD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly db: SqliteHandle,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  private compile(): SqliteStatement {
    return this.db.prepare(this.sql);
  }

  async first<T>(): Promise<T | null> {
    const row = this.compile().get(...this.values);
    return (row ?? null) as T | null;
  }

  async all<T>(): Promise<D1Result<T>> {
    const rows = this.compile().all(...this.values);
    return { results: rows as T[], success: true, meta: makeMeta(rows.length) };
  }

  async run<T>(): Promise<D1Result<T>> {
    const info = this.compile().run(...this.values);
    return {
      results: [],
      success: true,
      meta: makeMeta(Number(info.changes), Number(info.lastInsertRowid)),
    };
  }
}

class SqliteD1 {
  constructor(private readonly db: SqliteHandle) {}

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.db, sql);
  }
}

function createDb(): { d1: D1Database; raw: SqliteHandle } {
  const raw = new DatabaseSync(':memory:') as unknown as SqliteHandle;
  raw.exec(readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  return { d1: new SqliteD1(raw) as unknown as D1Database, raw };
}

function seedUsers(raw: SqliteHandle, ids: number[], banned: number[] = []): void {
  const insert = raw.prepare(
    'INSERT INTO users (user_id, username, points, is_banned) VALUES (?, ?, 0, ?)',
  );
  for (const id of ids) {
    insert.run(id, `u${id}`, banned.includes(id) ? 1 : 0);
  }
}

/**
 * 记录实际收到消息的用户，用来断言「谁收到了、谁不该收到」。
 * blocked：模拟用户拉黑 Bot（永久性错误 → 计入跳过）；
 * broken：模拟网络/接口临时错误（重试耗尽 → 计入失败）。
 */
function makeDeliverer(
  sent: number[],
  failures: { blocked?: number[]; broken?: number[] } = {},
): BroadcastDeliverer {
  const record = (chatId: number): void => {
    if (failures.blocked?.includes(chatId)) {
      throw new Error('bot was blocked by the user');
    }
    if (failures.broken?.includes(chatId)) {
      throw new Error('Bad Gateway');
    }
    sent.push(chatId);
  };
  return {
    sendText: async (chatId) => {
      record(chatId);
    },
    sendMedia: async (chatId) => {
      record(chatId);
    },
  };
}

const NO_DELAY = { delayMs: 0, retryDelaysMs: [] as readonly number[], sleep: async () => {} };

async function createNowBroadcast(
  d1: D1Database,
  content = '测试广播内容',
): Promise<number> {
  const row = await createBroadcast(d1, {
    content: serializeBroadcastText(content),
    type: 'now',
    scheduledAt: new Date().toISOString(),
    createdBy: 1,
  });
  return row.id;
}

describe('广播分批发送', () => {
  it('首批只发 batchSize 个用户，游标推进并把状态交回 pending', async () => {
    const { d1, raw } = createDb();
    seedUsers(raw, [1, 2, 3, 4, 5], [99]);
    const id = await createNowBroadcast(d1);
    const sent: number[] = [];
    const row = (await getBroadcast(d1, id))!;

    const report = await executeBroadcast(d1, row, makeDeliverer(sent), {
      ...NO_DELAY,
      batchSize: 2,
    });

    // 只发了前两个用户，被拉黑的 99 不参与
    expect(sent).toEqual([1, 2]);
    expect(report.finished).toBe(false);
    expect(report.processed).toBe(2);
    expect(report.total).toBe(5);

    const after = (await getBroadcast(d1, id))!;
    expect(after.status).toBe('pending');
    expect(await getBroadcastCursor(d1, id)).toBe(2);
    expect(after.total_count).toBe(5);
    expect(after.success_count).toBe(2);
    // 续发时间必须晚于当前，交给下一轮每分钟 Cron
    expect(new Date(after.scheduled_at!).getTime()).toBeGreaterThan(Date.now());
  });

  it('续发从游标继续，不重复发给已处理用户，最后一批写终态与完成日志', async () => {
    const { d1, raw } = createDb();
    seedUsers(raw, [1, 2, 3, 4, 5]);
    const id = await createNowBroadcast(d1);
    const sent: number[] = [];
    const deliverer = makeDeliverer(sent);
    const options = { ...NO_DELAY, batchSize: 2 };

    let row = (await getBroadcast(d1, id))!;
    await executeBroadcast(d1, row, deliverer, options);
    row = (await getBroadcast(d1, id))!;
    await executeBroadcast(d1, row, deliverer, options);
    row = (await getBroadcast(d1, id))!;
    const finalReport = await executeBroadcast(d1, row, deliverer, options);

    // 5 个用户各发一次，没有重复
    expect(sent).toEqual([1, 2, 3, 4, 5]);
    expect(finalReport.finished).toBe(true);
    expect(finalReport.status).toBe('sent');
    expect(finalReport.success).toBe(5);

    const after = (await getBroadcast(d1, id))!;
    expect(after.status).toBe('sent');
    expect(after.success_count).toBe(5);
    expect(await getBroadcastCursor(d1, id)).toBe(5);
    expect(after.finished_at).not.toBeNull();

    // 完成日志必须写进 admin_logs
    const logs = raw
      .prepare('SELECT action, detail FROM admin_logs ORDER BY id')
      .all() as { action: string; detail: string }[];
    const finished = logs.filter((item) => item.action === 'broadcast_finished');
    expect(finished).toHaveLength(1);
    expect(finished[0].detail).toContain(`id=${id}`);
    expect(finished[0].detail).toContain('status=sent');
  });

  it('临时错误计入失败、拉黑计入跳过，两类都不阻塞后续批次', async () => {
    const { d1, raw } = createDb();
    seedUsers(raw, [1, 2, 3, 4]);
    const id = await createNowBroadcast(d1);
    const sent: number[] = [];
    const options = { ...NO_DELAY, batchSize: 4 };

    const report = await executeBroadcast(
      d1,
      (await getBroadcast(d1, id))!,
      makeDeliverer(sent, { blocked: [2], broken: [3] }),
      options,
    );

    expect(report.finished).toBe(true);
    expect(report.success).toBe(2);
    expect(report.fail).toBe(1);
    expect(report.skip).toBe(1);
    const after = (await getBroadcast(d1, id))!;
    // 有成功也有失败 → partial
    expect(after.status).toBe('partial');
    expect(after.fail_count).toBe(1);
    expect(after.skip_count).toBe(1);
  });

  it('陈旧 sending 被 Cron 恢复为 pending 后能继续发送', async () => {
    const { d1, raw } = createDb();
    seedUsers(raw, [1, 2, 3]);
    const id = await createNowBroadcast(d1);
    const sent: number[] = [];

    // 模拟 Worker 在第一批中途被终止：状态停在 sending，updated_at 停在 10 分钟前
    await updateBroadcastStatus(d1, id, 'sending');
    const staleAt = new Date(Date.now() - 10 * 60_000).toISOString();
    raw.prepare('UPDATE broadcasts SET updated_at = ? WHERE id = ?').run(staleAt, id);

    const result = await runBroadcastCron(d1, makeDeliverer(sent), {
      ...NO_DELAY,
      batchSize: 3,
      staleSendingMinutes: 5,
    });

    expect(result.recovered).toBe(1);
    expect(result.executed).toHaveLength(1);
    expect(result.executed[0].finished).toBe(true);
    expect(sent).toEqual([1, 2, 3]);
    const after = (await getBroadcast(d1, id))!;
    expect(after.status).toBe('sent');
  });

  it('正常发送中的广播不会被误判为陈旧', async () => {
    const { d1, raw } = createDb();
    seedUsers(raw, [1, 2, 3]);
    const id = await createNowBroadcast(d1);
    await updateBroadcastStatus(d1, id, 'sending');

    const result = await runBroadcastCron(d1, makeDeliverer([]), {
      ...NO_DELAY,
      staleSendingMinutes: 5,
    });

    expect(result.recovered).toBe(0);
    expect(result.executed).toHaveLength(0);
    expect((await getBroadcast(d1, id))!.status).toBe('sending');
  });
});

describe('buildBroadcastReport', () => {
  it('未发完时提示剩余人数与自动续发', () => {
    const text = buildBroadcastReport({
      broadcastId: 12,
      status: 'pending',
      total: 1000,
      success: 300,
      fail: 0,
      skip: 0,
      processed: 300,
      finished: false,
      message: '分批中',
      errors: [],
      nextScheduledAt: '2026-11-08T09:20:00.000Z',
    });
    expect(text).toContain('分批发送中');
    expect(text).toContain('剩余：700');
    expect(text).toContain('下次发送');
  });

  it('发完时给出最终状态', () => {
    const text = buildBroadcastReport({
      broadcastId: 12,
      status: 'sent',
      total: 1000,
      success: 990,
      fail: 10,
      skip: 0,
      processed: 300,
      finished: true,
      message: '完成',
      errors: [],
      nextScheduledAt: null,
    });
    expect(text).toContain('执行完成');
    expect(text).not.toContain('剩余：');
  });
});
