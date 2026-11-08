/**
 * 定时任务逻辑：签到记录清理、定时广播检查执行、统计预聚合。
 * 每个函数独立可调用，供任务 6 的 Cron Trigger 在 scheduled 事件中挂载。
 */

import {
  deleteSetting,
  getDueBroadcasts,
  getSettings,
  resetCheckinsBeforeDate,
  setSetting,
} from './db/queries';
import { recoverStaleBroadcasts } from './db/broadcast-batch';
import {
  executeBroadcast,
  type BroadcastDeliverer,
  type BroadcastExecutionOptions,
  type BroadcastProgressReport,
} from './handlers/broadcast';
import { clearExpiredRateLimits } from './services/rate-limit';
import { getStatsDashboard } from './services/stats';
import { errorMessage, utcNowIso, utcToday } from './utils/helpers';

export interface DailyMaintenanceOptions {
  now?: Date;
  /** 清理该天数之前的签到记录，默认 90 天。 */
  checkinRetentionDays?: number;
}

export interface DailyMaintenanceResult {
  date: string;
  cutoffDate: string;
  clearedCheckins: number;
  clearedRateLimits: number;
}

export interface StatsPreaggregationOptions {
  now?: Date;
  /** 快照保留天数，默认 30 天。 */
  retentionDays?: number;
}

export interface StatsPreaggregationResult {
  date: string;
  snapshotKey: string;
  removedSnapshots: string[];
}

export interface BroadcastCronOptions extends BroadcastExecutionOptions {
  now?: Date;
  /**
   * sending 状态视为「陈旧」的阈值（分钟），默认 5。
   * 批量发送时每 50 个用户会刷新一次 updated_at，所以正常批次的 updated_at
   * 最多滞后几十秒；超过 5 分钟仍未更新，说明 Worker 已被终止。
   * 阈值不宜过小，否则会把仍在正常发送的批次误判为陈旧并重复发送。
   */
  staleSendingMinutes?: number;
}

export interface BroadcastCronResult {
  checked: number;
  /** 本轮恢复为 pending 的陈旧 sending 广播数量。 */
  recovered: number;
  executed: BroadcastProgressReport[];
  errors: string[];
}

/**
 * 每日维护：签到按 (user_id, date) 自然去重，无需重置；
 * 这里显式清理 retentionDays 之前的旧签到记录与过期限流记录。
 */
export async function runDailyMaintenance(
  db: D1Database,
  options: DailyMaintenanceOptions = {},
): Promise<DailyMaintenanceResult> {
  const now = options.now ?? new Date();
  const retentionDays = Math.max(options.checkinRetentionDays ?? 90, 1);
  const cutoffDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - retentionDays),
  )
    .toISOString()
    .slice(0, 10);
  const clearedCheckins = await resetCheckinsBeforeDate(db, cutoffDate);
  const clearedRateLimits = await clearExpiredRateLimits(db, { now });
  return {
    date: utcToday(),
    cutoffDate,
    clearedCheckins,
    clearedRateLimits,
  };
}

/**
 * 统计预聚合基础实现：把近 7 日仪表盘数据写入 settings 快照，
 * 供后台 API 直接读取，并清理超过 retentionDays 的旧快照。
 */
export async function runStatsPreaggregation(
  db: D1Database,
  options: StatsPreaggregationOptions = {},
): Promise<StatsPreaggregationResult> {
  const now = options.now ?? new Date();
  const date = now.toISOString().slice(0, 10);
  const dashboard = await getStatsDashboard(db, 7);
  const key = `stats_snapshot_${date}`;
  const snapshot = JSON.stringify({
    generatedAt: utcNowIso(),
    overview: dashboard.overview,
    trend: dashboard.trend,
    hourly: dashboard.hourly,
    pointsCycle: dashboard.pointsCycle,
    topResources: dashboard.topResources,
  });
  await setSetting(db, key, snapshot);

  const retentionDays = Math.max(options.retentionDays ?? 30, 1);
  const prefix = 'stats_snapshot_';
  const all = await getSettings(db);
  const keys = Object.keys(all)
    .filter((item) => item.startsWith(prefix))
    .sort();
  const removedSnapshots: string[] = [];
  while (keys.length > retentionDays) {
    const oldKey = keys.shift();
    if (oldKey) {
      await deleteSetting(db, oldKey);
      removedSnapshots.push(oldKey);
    }
  }
  return { date, snapshotKey: key, removedSnapshots };
}

/**
 * 定时广播检查：每轮先把被终止打断、陈旧卡在 sending 的广播恢复为 pending，
 * 再扫描到期的 pending/scheduled 广播。每条广播本轮只处理一个批次，
 * 剩余用户由下一轮（每分钟）Cron 从游标继续；单条失败不会中断其余广播。
 */
export async function runBroadcastCron(
  db: D1Database,
  deliverer: BroadcastDeliverer,
  options: BroadcastCronOptions = {},
): Promise<BroadcastCronResult> {
  const now = options.now ?? new Date();
  const errors: string[] = [];
  // 恢复陈旧 sending：这是「永久发送中」的兜底，必须在扫描到期广播之前执行。
  const staleMinutes = Math.max(options.staleSendingMinutes ?? 5, 1);
  let recovered = 0;
  try {
    recovered = await recoverStaleBroadcasts(
      db,
      new Date(now.getTime() - staleMinutes * 60_000).toISOString(),
      now.toISOString(),
    );
  } catch (err) {
    errors.push(`恢复陈旧广播失败：${errorMessage(err)}`);
  }
  let due: Awaited<ReturnType<typeof getDueBroadcasts>> = [];
  try {
    due = await getDueBroadcasts(db, now.toISOString());
  } catch (err) {
    errors.push(`读取到期广播失败：${errorMessage(err)}`);
    return { checked: 0, recovered, executed: [], errors };
  }
  const executed: BroadcastProgressReport[] = [];
  for (const broadcast of due) {
    try {
      executed.push(await executeBroadcast(db, broadcast, deliverer, options));
    } catch (err) {
      errors.push(`广播 #${broadcast.id} 执行失败：${errorMessage(err)}`);
    }
  }
  return { checked: due.length, recovered, executed, errors };
}

export interface ScheduledTasksResult {
  maintenance: DailyMaintenanceResult;
  preaggregation: StatsPreaggregationResult;
  broadcasts: BroadcastCronResult;
  errors: string[];
}

/** 一次 Cron 触发的完整入口：每日维护 + 统计预聚合 + 定时广播检查。 */
export async function runScheduledTasks(
  db: D1Database,
  deliverer: BroadcastDeliverer,
  options: BroadcastCronOptions = {},
): Promise<ScheduledTasksResult> {
  const errors: string[] = [];
  const maintenance = await runDailyMaintenanceSafely(db, options, errors);
  const preaggregation = await runStatsPreaggregationSafely(db, options, errors);
  const broadcasts = await runBroadcastCron(db, deliverer, options);
  return { maintenance, preaggregation, broadcasts, errors };
}

async function runDailyMaintenanceSafely(
  db: D1Database,
  options: BroadcastCronOptions,
  errors: string[],
): Promise<DailyMaintenanceResult> {
  try {
    return await runDailyMaintenance(db, { now: options.now });
  } catch (err) {
    errors.push(`每日维护失败：${errorMessage(err)}`);
    return {
      date: utcToday(),
      cutoffDate: '',
      clearedCheckins: 0,
      clearedRateLimits: 0,
    };
  }
}

async function runStatsPreaggregationSafely(
  db: D1Database,
  options: BroadcastCronOptions,
  errors: string[],
): Promise<StatsPreaggregationResult> {
  try {
    return await runStatsPreaggregation(db, { now: options.now });
  } catch (err) {
    errors.push(`统计预聚合失败：${errorMessage(err)}`);
    return { date: utcToday(), snapshotKey: '', removedSnapshots: [] };
  }
}
