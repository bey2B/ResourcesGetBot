/**
 * 全项目共享类型定义。
 * 时间字段统一使用 UTC ISO-8601 字符串（例如 2026-08-09T08:30:00.000Z），
 * 展示层再通过 src/utils/helpers.ts 转换为本地可读格式。
 */

// ---------- 数据库实体类型（字段与 src/db/schema.sql 保持一致） ----------

export interface User {
  user_id: number;
  username: string | null;
  first_name: string | null;
  points: number;
  invited_by: number | null;
  is_banned: number;
  created_at: string;
  last_active: string | null;
}

export interface Resource {
  id: number;
  short_code: string;
  file_id: string;
  file_unique_id: string | null;
  file_ids: string;
  title: string;
  tags: string;
  is_paid: number;
  price: number;
  sequence: number;
  download_count: number;
  creator_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ResourceFile {
  id: number;
  resource_id: number;
  file_id: string;
  file_unique_id: string | null;
  media_type: string;
  sort_order: number;
  created_at: string;
}

export interface Download {
  id: number;
  user_id: number;
  resource_id: number;
  created_at: string;
  title: string;
  short_code: string;
  username: string | null;
}

export interface Purchase {
  id: number;
  user_id: number;
  resource_id: number;
  price: number;
  created_at: string;
}

export interface Checkin {
  id: number;
  user_id: number;
  date: string;
  created_at: string;
}

export type BroadcastStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'scheduled';
export type BroadcastType = 'now' | 'once' | 'daily' | 'weekly' | 'monthly';

export interface Broadcast {
  id: number;
  content: string;
  status: BroadcastStatus;
  type: BroadcastType;
  scheduled_at: string | null;
  created_by: number;
  total_count: number;
  success_count: number;
  fail_count: number;
  skip_count: number;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AdPosition = 'top' | 'bottom';

export interface Ad {
  id: number;
  position: AdPosition;
  content: string;
  weight: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface AdButton {
  text: string;
  url: string;
}

export interface AdMessage {
  id: number;
  ad_id: number;
  text: string;
  media_file_id: string | null;
  media_unique_id: string | null;
  media_type: string;
  buttons: string;
  created_at: string;
  updated_at: string;
}

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

export interface AdminLog {
  id: number;
  admin_id: number;
  action: string;
  detail: string;
  created_at: string;
}

export interface RateLimit {
  user_id: number;
  resource_id: number;
  last_request: string;
  created_at: string;
}

export interface PointsLog {
  id: number;
  user_id: number;
  change: number;
  balance_after: number;
  reason: string;
  related_id: number | null;
  created_at: string;
}

// 与 queries.ts 现有行类型对齐的别名，后续任务收敛时可直接切换引用
export type UserRow = User;
export type ResourceRow = Resource;
export type ResourceFileRow = ResourceFile;
export type DownloadRow = Download;
export type PurchaseRow = Purchase;
export type CheckinRow = Checkin;
export type BroadcastRow = Broadcast;
export type AdRow = Ad;
export type AdMessageRow = AdMessage;
export type SettingRow = Setting;
export type AdminLogRow = AdminLog;
export type RateLimitRow = RateLimit;
export type PointsLogRow = PointsLog;

// ---------- 统计相关类型 ----------

export interface UserStats {
  download_count: number;
  checkin_count: number;
  invite_count: number;
}

export interface DailyCount {
  date: string;
  count: number;
}

export interface HourlyCount {
  hour: string;
  count: number;
}

export interface HourlyActivity {
  hour: number;
  count: number;
}

export interface DashboardOverview {
  totalUsers: number;
  totalResources: number;
  totalDownloads: number;
  bannedUsers: number;
  todayNewUsers: number;
  todayActiveUsers: number;
  todayDownloads: number;
  todayCheckins: number;
  totalPointsIssued: number;
  totalPointsSpent: number;
}

export interface PointsCycleStats {
  issued: number;
  spent: number;
  net: number;
  byReason: {
    reason: string;
    totalChange: number;
    count: number;
  }[];
}

// ---------- Worker 环境变量 ----------

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  ADMIN_IDS: string;
  ADMIN_PASSWORD_HASH: string;
  BOT_TOKEN: string;
  JWT_SECRET?: string;
  WEBHOOK_SECRET?: string;
  ADMIN_IP_WHITELIST?: string;
  ADMIN_CORS_ORIGIN?: string;
}

// ---------- 管理后台 JWT ----------

export interface AdminJwtPayload {
  sub: string;
  role: 'admin';
  userId: number;
}

// ---------- API 通用响应类型 ----------

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  code: ApiErrorCode | string;
  message: string;
  details?: unknown;
}

export interface ApiSuccess<T = unknown> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiFailure;

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedData<T> {
  items: T[];
  meta: PaginationMeta;
}

export type PaginatedResponse<T> = ApiSuccess<PaginatedData<T>>;
