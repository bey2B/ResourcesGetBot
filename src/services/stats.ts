/**
 * 统计服务：聚合仪表盘指标、7 日趋势、24 小时热力图与积分循环数据。
 * 所有聚合查询复用 queries.ts，这里只负责组合与类型收敛。
 */

import {
  getActiveUsersByDay,
  getDashboardOverview,
  getDownloadActivityByHour,
  getDownloadsByDay,
  getHourlyDownloadStats,
  getNewUsersByDay,
  getPointsCycleStats,
  getTopDownloadedResources,
} from '../db/queries';
import type {
  DailyCount,
  DashboardOverview,
  HourlyActivity,
  HourlyCount,
  PointsCycleStats,
  Resource,
} from '../types';

export interface SevenDayTrend {
  newUsers: DailyCount[];
  activeUsers: DailyCount[];
  downloads: DailyCount[];
}

export interface TwentyFourHourStats {
  hourlyDownloads: HourlyCount[];
  hourlyActivity: HourlyActivity[];
}

export interface StatsDashboard {
  overview: DashboardOverview;
  trend: SevenDayTrend;
  hourly: TwentyFourHourStats;
  pointsCycle: PointsCycleStats;
  topResources: Resource[];
}

function normalizeDays(days: number): number {
  if (!Number.isInteger(days) || days <= 0) {
    return 7;
  }
  return Math.min(days, 90);
}

export async function getDashboardOverviewStats(db: D1Database): Promise<DashboardOverview> {
  return getDashboardOverview(db);
}

export async function getSevenDayTrend(
  db: D1Database,
  days = 7,
): Promise<SevenDayTrend> {
  const [newUsers, activeUsers, downloads] = await Promise.all([
    getNewUsersByDay(db, normalizeDays(days)),
    getActiveUsersByDay(db, normalizeDays(days)),
    getDownloadsByDay(db, normalizeDays(days)),
  ]);
  return { newUsers, activeUsers, downloads };
}

export async function getTwentyFourHourStats(
  db: D1Database,
  days = 7,
): Promise<TwentyFourHourStats> {
  const [hourlyDownloads, hourlyActivity] = await Promise.all([
    getHourlyDownloadStats(db, 24),
    getDownloadActivityByHour(db, normalizeDays(days)),
  ]);
  return { hourlyDownloads, hourlyActivity };
}

export async function getStatsDashboard(
  db: D1Database,
  days = 7,
): Promise<StatsDashboard> {
  const normalized = normalizeDays(days);
  const [overview, trend, hourly, pointsCycle, topResources] = await Promise.all([
    getDashboardOverview(db),
    getSevenDayTrend(db, normalized),
    getTwentyFourHourStats(db, normalized),
    getPointsCycleStats(db),
    getTopDownloadedResources(db, 10),
  ]);
  return { overview, trend, hourly, pointsCycle, topResources };
}
