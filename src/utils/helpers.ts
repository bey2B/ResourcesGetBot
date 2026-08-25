/**
 * 通用工具：错误归一化、时间格式化、分页参数。
 * 时间统一以 Asia/Shanghai (UTC+8) 为业务时区，存储层仍用 UTC。
 */

export const DEFAULT_TIMEZONE = 'Asia/Shanghai';
export const SQL_TZ_OFFSET = '+8 hours';

export class AppError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, statusCode = 400, code = 'APP_ERROR') {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface NormalizedError {
  message: string;
  statusCode: number;
  code: string;
}

export function normalizeError(err: unknown): NormalizedError {
  if (err instanceof AppError) {
    return { message: err.message, statusCode: err.statusCode, code: err.code };
  }
  if (err instanceof Error) {
    return { message: err.message, statusCode: 500, code: 'INTERNAL_ERROR' };
  }
  return { message: String(err), statusCode: 500, code: 'INTERNAL_ERROR' };
}

export function errorMessage(err: unknown): string {
  return normalizeError(err).message;
}

/** 返回当前 UTC ISO 字符串。 */
export function utcNowIso(): string {
  return new Date().toISOString();
}

/** 返回指定时区的今天日期（YYYY-MM-DD）。默认 Asia/Shanghai。 */
export function todayInZone(timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * 格式化 UTC ISO 时间为本地可读字符串。
 * Workers 运行时默认时区为 UTC，因此必须显式指定 timeZone，
 * 否则 getHours/getDate 等会返回 UTC 值而非用户期望的本地时间。
 */
export function formatLocalDateTime(
  iso: string,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export function parsePageParams(
  query: URLSearchParams,
): { page: number; pageSize: number } {
  const page = Math.max(1, Number(query.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.get('pageSize')) || 20));
  return { page, pageSize };
}
