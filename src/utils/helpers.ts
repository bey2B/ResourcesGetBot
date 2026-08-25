import type { ApiErrorCode, ApiResponse, PaginatedData, PaginationMeta } from '../types';

// ---------- UTC 时间工具 ----------

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function utcNowIso(): string {
  return new Date().toISOString();
}

export function utcToday(): string {
  return utcNowIso().slice(0, 10);
}

// ---------- 目标用户时区工具 ----------

/** 面向用户的业务时区，所有日期结算、统计分组、时间显示统一使用。 */
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/** SQLite 时间偏移修饰符，用于 SQL 中按本地时区分组日期/小时。 */
export const SQL_TZ_OFFSET = '+8 hours';

/** 返回目标时区的当前日期（YYYY-MM-DD），用于签到、统计等业务结算。 */
export function todayInZone(timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function formatUtcDate(value: string | number | Date): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function formatUtcDateTime(value: string | number | Date, withSeconds = true): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  const time =
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}` +
    (withSeconds ? `:${pad2(date.getUTCSeconds())}` : '');
  return `${formatUtcDate(date)} ${time}`;
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function formatLocalDateTime(
  value: string | number | Date,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

// ---------- JSON 响应封装 ----------

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function ok<T>(data: T, message?: string): Response {
  const body: ApiResponse<T> = { success: true, data };
  if (message !== undefined) {
    (body as { message?: string }).message = message;
  }
  return jsonResponse(body, { status: 200 });
}

export function fail(
  message: string,
  status = 500,
  code: ApiErrorCode | string = 'INTERNAL_ERROR',
  details?: unknown,
): Response {
  const body: ApiResponse<never> = {
    success: false,
    error: { code, message },
  };
  if (details !== undefined) {
    body.error.details = details;
  }
  return jsonResponse(body, { status });
}

export function badRequest(message: string, details?: unknown): Response {
  return fail(message, 400, 'BAD_REQUEST', details);
}

export function unauthorized(message = '未授权'): Response {
  return fail(message, 401, 'UNAUTHORIZED');
}

export function forbidden(message = '禁止访问'): Response {
  return fail(message, 403, 'FORBIDDEN');
}

export function notFound(message = '资源不存在'): Response {
  return fail(message, 404, 'NOT_FOUND');
}

export function rateLimited(message = '请求过于频繁', details?: unknown): Response {
  return fail(message, 429, 'RATE_LIMITED', details);
}

// ---------- 分页 ----------

export interface PaginationOptions {
  defaultPage?: number;
  defaultPageSize?: number;
  maxPageSize?: number;
}

export interface ParsedPagination {
  page: number;
  pageSize: number;
  offset: number;
}

function readQueryParam(input: URLSearchParams | Record<string, unknown>, key: string): string | undefined {
  if (input instanceof URLSearchParams) {
    return input.get(key) ?? undefined;
  }
  const value = input[key];
  return value === undefined || value === null ? undefined : String(value);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parsePagination(
  input: URLSearchParams | Record<string, unknown>,
  options: PaginationOptions = {},
): ParsedPagination {
  const defaultPage = options.defaultPage ?? 1;
  const defaultPageSize = options.defaultPageSize ?? 50;
  const maxPageSize = options.maxPageSize ?? 200;
  const page = parsePositiveInt(readQueryParam(input, 'page'), defaultPage);
  const pageSize = Math.min(Math.max(parsePositiveInt(readQueryParam(input, 'pageSize'), defaultPageSize), 1), maxPageSize);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function buildPaginationMeta(total: number, page: number, pageSize: number): PaginationMeta {
  const safeTotal = Math.max(0, Math.trunc(total) || 0);
  return {
    page,
    pageSize,
    total: safeTotal,
    totalPages: safeTotal === 0 ? 0 : Math.ceil(safeTotal / pageSize),
  };
}

export function okPaginated<T>(items: T[], total: number, page: number, pageSize: number): Response {
  const data: PaginatedData<T> = {
    items,
    meta: buildPaginationMeta(total, page, pageSize),
  };
  return ok(data);
}

// ---------- 列表与布尔解析 ----------

export function parseCsv(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseUniqueCsv(raw: string | null | undefined): string[] {
  return [...new Set(parseCsv(raw))];
}

export function parseBoolean(value: string | null | undefined, fallback = false): boolean {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

// ---------- Telegram 文案转义 ----------

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

export function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[\]])/g, '\\$1');
}

// ---------- 数值与价格格式化 ----------

export function formatNumber(value: number, maxFractionDigits = 0): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: maxFractionDigits }).format(value);
}

export function formatPrice(points: number, label = '积分'): string {
  return `${formatNumber(points)} ${label}`;
}

// ---------- 错误标准化 ----------

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode | string;
  readonly details?: unknown;
  constructor(message: string, statusCode = 500, code: ApiErrorCode | string = 'INTERNAL_ERROR', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

function safeStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }
  if (err instanceof Error) {
    return new AppError(err.message, 500, 'INTERNAL_ERROR');
  }
  const message = typeof err === 'string' ? err : safeStringify(err);
  return new AppError(message || '未知错误', 500, 'INTERNAL_ERROR');
}

export function errorMessage(err: unknown): string {
  return normalizeError(err).message;
}

// ---------- 请求辅助 ----------

export function extractClientIp(request: Request): string | null {
  const cfIp = request.headers.get('CF-Connecting-IP');
  if (cfIp && cfIp.trim()) {
    return cfIp.trim();
  }
  const forwarded = request.headers.get('X-Forwarded-For');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }
  return null;
}
