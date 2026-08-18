/**
 * 风控限流服务。
 * 同一用户短时间重复请求同一资源时按 rate_limit_seconds（settings 表）限流，
 * 窗口记录持久化到 rate_limits 表。
 */

import {
  clearExpiredRateLimits as clearExpiredRateLimitRows,
  deleteRateLimit as removeRateLimitRow,
  getRateLimit,
  getSetting,
  setRateLimit as saveRateLimitRow,
} from '../db/queries';
import { AppError } from '../utils/helpers';

export const RATE_LIMIT_SECONDS_KEY = 'rate_limit_seconds';
export const DEFAULT_RATE_LIMIT_SECONDS = 30;

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  limitSeconds: number;
  message: string;
  lastRequest: string | null;
}

export interface RateLimitOptions {
  now?: Date;
  intervalSeconds?: number;
}

function parseInterval(raw: string | null, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validateIds(userId: number, resourceId: number): void {
  if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(resourceId) || resourceId <= 0) {
    throw new AppError('限流参数无效：user_id 与 resource_id 必须为正整数', 400, 'VALIDATION_ERROR');
  }
}

export async function getRateLimitSeconds(
  db: D1Database,
  intervalSeconds?: number,
): Promise<number> {
  if (intervalSeconds !== undefined) {
    if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
      throw new AppError('限流间隔必须是正整数秒', 400, 'VALIDATION_ERROR');
    }
    return intervalSeconds;
  }
  return parseInterval(await getSetting(db, RATE_LIMIT_SECONDS_KEY), DEFAULT_RATE_LIMIT_SECONDS);
}

function allowedDecision(limitSeconds: number, lastRequest: string | null): RateLimitDecision {
  return {
    allowed: true,
    retryAfterSeconds: 0,
    limitSeconds,
    message: '请求已通过限流检查',
    lastRequest,
  };
}

export async function checkRateLimit(
  db: D1Database,
  userId: number,
  resourceId: number,
  options: RateLimitOptions = {},
): Promise<RateLimitDecision> {
  validateIds(userId, resourceId);
  const now = options.now ?? new Date();
  const limitSeconds = await getRateLimitSeconds(db, options.intervalSeconds);
  const row = await getRateLimit(db, userId, resourceId);
  if (!row) {
    return allowedDecision(limitSeconds, null);
  }
  const lastRequest = Date.parse(row.last_request);
  if (Number.isNaN(lastRequest)) {
    return allowedDecision(limitSeconds, row.last_request);
  }
  const elapsedMs = now.getTime() - lastRequest;
  if (elapsedMs >= limitSeconds * 1000) {
    return allowedDecision(limitSeconds, row.last_request);
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((limitSeconds * 1000 - elapsedMs) / 1000));
  return {
    allowed: false,
    retryAfterSeconds,
    limitSeconds,
    message: `操作过于频繁，请等待 ${retryAfterSeconds} 秒后重试。`,
    lastRequest: row.last_request,
  };
}

/** 限流通过时刷新持久化时间戳；被限流时保持原时间戳，避免用户通过重试续期。 */
export async function consumeRateLimit(
  db: D1Database,
  userId: number,
  resourceId: number,
  options: RateLimitOptions = {},
): Promise<RateLimitDecision> {
  const decision = await checkRateLimit(db, userId, resourceId, options);
  if (!decision.allowed) {
    return decision;
  }
  const timestamp = (options.now ?? new Date()).toISOString();
  await saveRateLimitRow(db, userId, resourceId, timestamp);
  return { ...decision, lastRequest: timestamp };
}

export async function resetRateLimit(
  db: D1Database,
  userId: number,
  resourceId: number,
): Promise<boolean> {
  validateIds(userId, resourceId);
  return removeRateLimitRow(db, userId, resourceId);
}

/** 按当前限流间隔清理过期窗口记录，返回清理条数。 */
export async function clearExpiredRateLimits(
  db: D1Database,
  options: RateLimitOptions = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const limitSeconds = await getRateLimitSeconds(db, options.intervalSeconds);
  const before = new Date(now.getTime() - limitSeconds * 1000).toISOString();
  return clearExpiredRateLimitRows(db, before);
}
