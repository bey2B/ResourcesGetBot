/**
 * 广播分批发送专用的数据库操作。
 *
 * 为什么单独成文件：分批发送引入了「游标、续排期、陈旧 sending 恢复」这一套
 * 只服务于广播发送状态机的读写，和 queries.ts 里通用的 CRUD 不是一类东西；
 * 放在一起会把 2000 行的通用查询层继续撑大，也不利于以后单独调整分批策略。
 */

function utcNow(): string {
  return new Date().toISOString();
}

/** 广播可触达用户总数（未封禁），用于确定本轮广播的 total_count。 */
export async function countBroadcastRecipients(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM users WHERE is_banned = 0')
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * 分批拉取广播目标用户：只取 user_id 大于游标的未封禁用户，按 id 升序。
 * 用游标分页而不是 OFFSET：不随表增长而变慢，中断后能从断点续发、不重头。
 */
export async function listUserIdsForBroadcastBatch(
  db: D1Database,
  afterUserId: number,
  limit: number,
): Promise<number[]> {
  const result = await db
    .prepare(
      `SELECT user_id FROM users
       WHERE is_banned = 0 AND user_id > ?
       ORDER BY user_id ASC
       LIMIT ?`,
    )
    .bind(afterUserId, limit)
    .all<{ user_id: number }>();
  return result.results.map((row) => row.user_id);
}

/** 读取当前游标（已处理到的最大 user_id）；广播刚创建时为 0。 */
export async function getBroadcastCursor(db: D1Database, broadcastId: number): Promise<number> {
  const row = await db
    .prepare('SELECT last_user_id FROM broadcasts WHERE id = ?')
    .bind(broadcastId)
    .first<{ last_user_id: number | null }>();
  return Number(row?.last_user_id ?? 0);
}

export interface BroadcastBatchProgress {
  totalCount: number;
  successCount: number;
  failCount: number;
  skipCount: number;
  /** 本批处理到的最大 user_id。 */
  lastUserId: number;
}

/**
 * 落盘一批进度：游标 + 累计计数 + updated_at。
 * updated_at 同时充当「进程还活着」的心跳，陈旧 sending 判断依赖它。
 */
export async function flushBroadcastBatch(
  db: D1Database,
  broadcastId: number,
  progress: BroadcastBatchProgress,
): Promise<void> {
  await db
    .prepare(
      `UPDATE broadcasts
       SET total_count = ?, success_count = ?, fail_count = ?, skip_count = ?,
           last_user_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      progress.totalCount,
      progress.successCount,
      progress.failCount,
      progress.skipCount,
      progress.lastUserId,
      utcNow(),
      broadcastId,
    )
    .run();
}

/**
 * 本批未发完：置回 pending 并安排下一次到期时间（1 分钟后），
 * 不动游标与计数，让下一轮 Cron 从断点继续。
 */
export async function scheduleBroadcastContinuation(
  db: D1Database,
  broadcastId: number,
  nextScheduledAt: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE broadcasts
       SET status = 'pending', scheduled_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(nextScheduledAt, utcNow(), broadcastId)
    .run();
  return result.meta.changes > 0;
}

/**
 * 恢复陈旧 sending：Worker 在某一批中途被终止后，status 会一直停在 sending，
 * 而 getDueBroadcasts 只扫 pending/scheduled，导致该广播永久卡死。
 * 这里把 updated_at 早于 staleBefore 的 sending 置回 pending 并立刻到期，
 * 交给本轮 Cron 从游标继续发送。
 */
export async function recoverStaleBroadcasts(
  db: D1Database,
  staleBefore: string,
  dueAt: string,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE broadcasts
       SET status = 'pending', scheduled_at = ?, updated_at = ?
       WHERE status = 'sending' AND updated_at < ?`,
    )
    .bind(dueAt, utcNow(), staleBefore)
    .run();
  return result.meta.changes;
}

/**
 * 一轮广播全部发完后，为周期型广播（每日/每周/每月）安排下一轮：
 * 清空本轮计数并把游标归零，否则下一轮会从上一轮的游标继续、一个人也发不到。
 */
export async function resetBroadcastCycle(
  db: D1Database,
  broadcastId: number,
  nextScheduledAt: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE broadcasts
       SET scheduled_at = ?, status = 'pending', total_count = 0,
           success_count = 0, fail_count = 0, skip_count = 0,
           last_user_id = 0, finished_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(nextScheduledAt, utcNow(), broadcastId)
    .run();
  return result.meta.changes > 0;
}
