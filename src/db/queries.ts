/**
 * D1 数据库读写操作统一封装。
 * 所有函数均接收 D1Database（Worker 中对应 env.DB），时间统一使用 UTC ISO-8601 字符串存储。
 * 业务规则（短码生成重试、积分发放、风控窗口判断等）由后续 services/handlers 负责。
 */

// ---------- 通用工具 ----------

function utcNow(): string {
  return new Date().toISOString();
}

function utcToday(): string {
  return utcNow().slice(0, 10);
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function startOfNextUtcDay(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toISOString();
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function pickSortColumn(
  sortBy: string | undefined,
  fallback: string,
  allowed: readonly string[],
): string {
  return sortBy !== undefined && allowed.includes(sortBy) ? sortBy : fallback;
}

function hourLabel(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:00`;
}

// ---------- 行类型（后续任务统一收敛到 src/types.ts） ----------

export interface UserRow {
  user_id: number;
  username: string | null;
  first_name: string | null;
  points: number;
  invited_by: number | null;
  is_banned: number;
  created_at: string;
  last_active: string | null;
}

export interface ResourceRow {
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

export interface ResourceFileRow {
  id: number;
  resource_id: number;
  file_id: string;
  file_unique_id: string | null;
  media_type: string;
  sort_order: number;
  created_at: string;
}

export interface DownloadRow {
  id: number;
  user_id: number;
  resource_id: number;
  created_at: string;
  title: string;
  short_code: string;
  username: string | null;
}

export interface PurchaseRow {
  id: number;
  user_id: number;
  resource_id: number;
  price: number;
  created_at: string;
}

export interface CheckinRow {
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

export interface BroadcastRow {
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

export interface AdRow {
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

export interface AdMessageRow {
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

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export interface AdminLogRow {
  id: number;
  admin_id: number;
  action: string;
  detail: string;
  created_at: string;
}

export interface RateLimitRow {
  user_id: number;
  resource_id: number;
  last_request: string;
  created_at: string;
}

export interface PointsLogRow {
  id: number;
  user_id: number;
  change: number;
  balance_after: number;
  reason: string;
  related_id: number | null;
  created_at: string;
}

export interface DailyCountRow {
  date: string;
  count: number;
}

export interface HourlyCountRow {
  hour: string;
  count: number;
}

export interface HourlyActivityRow {
  hour: number;
  count: number;
}

// ---------- 用户 ----------

export interface UserUpsertInput {
  userId: number;
  username?: string | null;
  firstName?: string | null;
  invitedBy?: number | null;
  lastActive?: string;
}

export interface UserListOptions {
  page?: number;
  pageSize?: number;
  keyword?: string;
  banned?: boolean;
  sortBy?: 'user_id' | 'username' | 'points' | 'created_at' | 'last_active';
  sortOrder?: 'asc' | 'desc';
}

export interface UserStatsRow {
  download_count: number;
  checkin_count: number;
  invite_count: number;
}

function buildUserFilter(options: { keyword?: string; banned?: boolean }): {
  where: string;
  values: (string | number)[];
} {
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (options.keyword) {
    conditions.push('(CAST(user_id AS TEXT) LIKE ? OR username LIKE ?)');
    const keyword = `%${options.keyword}%`;
    values.push(keyword, keyword);
  }
  if (options.banned !== undefined) {
    conditions.push('is_banned = ?');
    values.push(options.banned ? 1 : 0);
  }
  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

export async function upsertUser(db: D1Database, input: UserUpsertInput): Promise<UserRow> {
  const now = input.lastActive ?? utcNow();
  await db
    .prepare(
      `INSERT INTO users (user_id, username, first_name, invited_by, created_at, last_active)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         username = COALESCE(excluded.username, users.username),
         first_name = COALESCE(excluded.first_name, users.first_name),
         last_active = excluded.last_active`,
    )
    .bind(input.userId, input.username ?? null, input.firstName ?? null, input.invitedBy ?? null, now, now)
    .run();
  const row = await getUser(db, input.userId);
  if (!row) {
    throw new Error(`创建用户失败: ${input.userId}`);
  }
  return row;
}

export async function getUser(db: D1Database, userId: number): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE user_id = ?').bind(userId).first<UserRow>();
}

export async function setUserPoints(db: D1Database, userId: number, points: number): Promise<boolean> {
  const result = await db.prepare('UPDATE users SET points = ? WHERE user_id = ?').bind(points, userId).run();
  return result.meta.changes > 0;
}

export async function adjustUserPoints(
  db: D1Database,
  userId: number,
  delta: number,
): Promise<number | null> {
  const result = await db
    .prepare('UPDATE users SET points = points + ? WHERE user_id = ?')
    .bind(delta, userId)
    .run();
  if (result.meta.changes === 0) {
    return null;
  }
  const user = await getUser(db, userId);
  return user?.points ?? null;
}

export async function banUser(db: D1Database, userId: number): Promise<boolean> {
  const result = await db.prepare('UPDATE users SET is_banned = 1 WHERE user_id = ?').bind(userId).run();
  return result.meta.changes > 0;
}

export async function unbanUser(db: D1Database, userId: number): Promise<boolean> {
  const result = await db.prepare('UPDATE users SET is_banned = 0 WHERE user_id = ?').bind(userId).run();
  return result.meta.changes > 0;
}

export async function updateLastActive(
  db: D1Database,
  userId: number,
  timestamp = utcNow(),
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE users SET last_active = ? WHERE user_id = ?')
    .bind(timestamp, userId)
    .run();
  return result.meta.changes > 0;
}

export async function getUserInviteCount(db: D1Database, userId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM users WHERE invited_by = ?')
    .bind(userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function listInvitedUsers(
  db: D1Database,
  userId: number,
  limit = 50,
  offset = 0,
): Promise<UserRow[]> {
  const result = await db
    .prepare('SELECT * FROM users WHERE invited_by = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .bind(userId, limit, offset)
    .all<UserRow>();
  return result.results;
}

export async function listUsers(db: D1Database, options: UserListOptions = {}): Promise<UserRow[]> {
  const { where, values } = buildUserFilter(options);
  const sortBy = pickSortColumn(options.sortBy, 'user_id', ['user_id', 'username', 'points', 'created_at', 'last_active']);
  const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const page = Math.max(options.page ?? 1, 1);
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;
  const result = await db
    .prepare(
      `SELECT * FROM users ${where} ORDER BY ${sortBy} ${sortOrder}, user_id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...values, pageSize, offset)
    .all<UserRow>();
  return result.results;
}

export async function countUsers(
  db: D1Database,
  options: { keyword?: string; banned?: boolean } = {},
): Promise<number> {
  const { where, values } = buildUserFilter(options);
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM users ${where}`)
    .bind(...values)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function countInvitedUsers(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM users WHERE invited_by IS NOT NULL')
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function listUserIdsForBroadcast(db: D1Database): Promise<number[]> {
  const result = await db
    .prepare('SELECT user_id FROM users WHERE is_banned = 0 ORDER BY user_id')
    .all<{ user_id: number }>();
  return result.results.map((row) => row.user_id);
}

export async function getUserStats(db: D1Database, userId: number): Promise<UserStatsRow | null> {
  const user = await getUser(db, userId);
  if (!user) {
    return null;
  }
  const results = await db.batch<{ count: number }>([
    db.prepare('SELECT COUNT(*) AS count FROM downloads WHERE user_id = ?').bind(userId),
    db.prepare('SELECT COUNT(*) AS count FROM checkins WHERE user_id = ?').bind(userId),
    db.prepare('SELECT COUNT(*) AS count FROM users WHERE invited_by = ?').bind(userId),
  ]);
  return {
    download_count: results[0].results[0]?.count ?? 0,
    checkin_count: results[1].results[0]?.count ?? 0,
    invite_count: results[2].results[0]?.count ?? 0,
  };
}

// ---------- 资源 ----------

export interface ResourceCreateInput {
  shortCode: string;
  fileId: string;
  fileUniqueId?: string | null;
  fileIds?: string[];
  /** 可选：写入 resource_files 时携带 media_type，供 album 模式识别 photo/video。 */
  files?: ResourceFileInput[];
  title?: string;
  tags?: string;
  isPaid?: boolean;
  price?: number;
  creatorId?: number | null;
}

export interface ResourceUpdateInput {
  shortCode?: string;
  fileId?: string;
  fileUniqueId?: string | null;
  fileIds?: string[];
  /** 可选：更新 resource_files 时携带 media_type，供 album 模式识别 photo/video。 */
  files?: ResourceFileInput[];
  title?: string;
  tags?: string;
  isPaid?: boolean;
  price?: number;
}

export interface ResourceListOptions {
  page?: number;
  pageSize?: number;
  keyword?: string;
  tag?: string;
  isPaid?: boolean;
  sortBy?: 'id' | 'sequence' | 'short_code' | 'title' | 'price' | 'download_count' | 'created_at';
  sortOrder?: 'asc' | 'desc';
}

function buildResourceFilter(options: { keyword?: string; tag?: string; isPaid?: boolean }): {
  where: string;
  values: (string | number)[];
} {
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (options.keyword) {
    conditions.push('(title LIKE ? OR short_code LIKE ? OR tags LIKE ?)');
    const keyword = `%${options.keyword}%`;
    values.push(keyword, keyword, keyword);
  }
  if (options.tag) {
    conditions.push("(',' || tags || ',') LIKE ?");
    values.push(`%,${options.tag},%`);
  }
  if (options.isPaid !== undefined) {
    conditions.push('is_paid = ?');
    values.push(options.isPaid ? 1 : 0);
  }
  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

export async function createResource(db: D1Database, input: ResourceCreateInput): Promise<ResourceRow> {
  const now = utcNow();
  const fileList =
    input.files?.map((file) => file.fileId) ??
    (input.fileIds?.length ? input.fileIds : [input.fileId]);
  const fileIds = JSON.stringify(fileList);
  // 序号在 SQL 内取当前最大值 +1，保证从 0 开始且不重复
  const result = await db
    .prepare(
      `INSERT INTO resources
         (short_code, file_id, file_unique_id, file_ids, title, tags, is_paid, price, sequence, creator_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sequence), -1) + 1 FROM resources), ?, ?, ?)`,
    )
    .bind(
      input.shortCode,
      input.fileId,
      input.fileUniqueId ?? null,
      fileIds,
      input.title ?? '',
      input.tags ?? '',
      input.isPaid ? 1 : 0,
      input.price ?? 0,
      input.creatorId ?? null,
      now,
      now,
    )
    .run();
  const row = await db
    .prepare('SELECT * FROM resources WHERE id = ?')
    .bind(result.meta.last_row_id)
    .first<ResourceRow>();
  if (!row) {
    throw new Error('创建资源后读取失败');
  }
  const resourceFiles = input.files ?? fileList.map((fileId, index) => ({ fileId, sortOrder: index }));
  await addResourceFiles(
    db,
    row.id,
    resourceFiles,
  );
  return row;
}

export async function getResourceById(db: D1Database, resourceId: number): Promise<ResourceRow | null> {
  return db.prepare('SELECT * FROM resources WHERE id = ?').bind(resourceId).first<ResourceRow>();
}

export async function getResourceByShortCode(
  db: D1Database,
  shortCode: string,
): Promise<ResourceRow | null> {
  return db.prepare('SELECT * FROM resources WHERE short_code = ?').bind(shortCode).first<ResourceRow>();
}

export async function listResources(
  db: D1Database,
  options: ResourceListOptions = {},
): Promise<ResourceRow[]> {
  const { where, values } = buildResourceFilter(options);
  const sortBy = pickSortColumn(options.sortBy, 'id', [
    'id',
    'sequence',
    'short_code',
    'title',
    'price',
    'download_count',
    'created_at',
  ]);
  const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const page = Math.max(options.page ?? 1, 1);
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;
  const result = await db
    .prepare(
      `SELECT * FROM resources ${where} ORDER BY ${sortBy} ${sortOrder}, id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...values, pageSize, offset)
    .all<ResourceRow>();
  return result.results;
}

export async function countResources(
  db: D1Database,
  options: { keyword?: string; tag?: string; isPaid?: boolean } = {},
): Promise<number> {
  const { where, values } = buildResourceFilter(options);
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM resources ${where}`)
    .bind(...values)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function updateResource(
  db: D1Database,
  resourceId: number,
  patch: ResourceUpdateInput,
): Promise<ResourceRow | null> {
  const sets: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  const fileRows =
    patch.files ??
    (patch.fileIds !== undefined
      ? patch.fileIds.map((fileId, index) => ({ fileId, sortOrder: index }))
      : null);
  if (patch.shortCode !== undefined) {
    sets.push('short_code = ?');
    values.push(patch.shortCode);
  }
  if (patch.fileId !== undefined) {
    sets.push('file_id = ?');
    values.push(patch.fileId);
  }
  if (patch.fileUniqueId !== undefined) {
    sets.push('file_unique_id = ?');
    values.push(patch.fileUniqueId);
  }
  if (patch.files !== undefined) {
    const fileIds = patch.files.map((file) => file.fileId);
    if (patch.fileId === undefined) {
      sets.push('file_id = ?');
      values.push(fileIds[0] ?? '');
    }
    sets.push('file_ids = ?');
    values.push(JSON.stringify(fileIds));
  } else if (patch.fileIds !== undefined) {
    sets.push('file_ids = ?');
    values.push(JSON.stringify(patch.fileIds));
  }
  if (patch.title !== undefined) {
    sets.push('title = ?');
    values.push(patch.title);
  }
  if (patch.tags !== undefined) {
    sets.push('tags = ?');
    values.push(patch.tags);
  }
  if (patch.isPaid !== undefined) {
    sets.push('is_paid = ?');
    values.push(patch.isPaid ? 1 : 0);
  }
  if (patch.price !== undefined) {
    sets.push('price = ?');
    values.push(patch.price);
  }
  if (sets.length === 0) {
    const row = await getResourceById(db, resourceId);
    if (row && fileRows) {
      await replaceResourceFiles(db, resourceId, fileRows);
    }
    return row;
  }
  sets.push('updated_at = ?');
  values.push(utcNow());
  const result = await db
    .prepare(`UPDATE resources SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, resourceId)
    .run();
  if (result.meta.changes === 0) {
    return null;
  }
  if (fileRows) {
    await replaceResourceFiles(db, resourceId, fileRows);
  }
  return getResourceById(db, resourceId);
}

export async function deleteResource(db: D1Database, resourceId: number): Promise<boolean> {
  const result = await db.prepare('DELETE FROM resources WHERE id = ?').bind(resourceId).run();
  return result.meta.changes > 0;
}

export async function incrementResourceDownloadCount(
  db: D1Database,
  resourceId: number,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE resources SET download_count = download_count + 1 WHERE id = ?')
    .bind(resourceId)
    .run();
  return result.meta.changes > 0;
}

export async function getNextResourceSequence(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(MAX(sequence), -1) + 1 AS next_sequence FROM resources')
    .first<{ next_sequence: number }>();
  return row?.next_sequence ?? 0;
}

// ---------- 资源文件 ----------

export interface ResourceFileInput {
  fileId: string;
  fileUniqueId?: string | null;
  mediaType?: string;
  sortOrder?: number;
}

export async function addResourceFiles(
  db: D1Database,
  resourceId: number,
  files: ResourceFileInput[],
): Promise<ResourceFileRow[]> {
  if (files.length === 0) {
    return [];
  }
  const now = utcNow();
  const statements = files.map((file, index) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO resource_files
           (resource_id, file_id, file_unique_id, media_type, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        resourceId,
        file.fileId,
        file.fileUniqueId ?? null,
        file.mediaType ?? '',
        file.sortOrder ?? index,
        now,
      ),
  );
  await db.batch(statements);
  return listResourceFiles(db, resourceId);
}

export async function replaceResourceFiles(
  db: D1Database,
  resourceId: number,
  files: ResourceFileInput[],
): Promise<ResourceFileRow[]> {
  await db.prepare('DELETE FROM resource_files WHERE resource_id = ?').bind(resourceId).run();
  return addResourceFiles(db, resourceId, files);
}

export async function listResourceFiles(
  db: D1Database,
  resourceId: number,
): Promise<ResourceFileRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM resource_files WHERE resource_id = ? ORDER BY sort_order ASC, id ASC',
    )
    .bind(resourceId)
    .all<ResourceFileRow>();
  return result.results;
}

export async function countResourceFiles(db: D1Database, resourceId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM resource_files WHERE resource_id = ?')
    .bind(resourceId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function countResourceFilesByResourceIds(
  db: D1Database,
  resourceIds: number[],
): Promise<Record<number, number>> {
  if (resourceIds.length === 0) {
    return {};
  }
  const placeholders = resourceIds.map(() => '?').join(', ');
  const result = await db
    .prepare(
      `SELECT resource_id, COUNT(*) AS count
       FROM resource_files
       WHERE resource_id IN (${placeholders})
       GROUP BY resource_id`,
    )
    .bind(...resourceIds)
    .all<{ resource_id: number; count: number }>();
  return Object.fromEntries(
    result.results.map((row) => [row.resource_id, Number(row.count ?? 0)]),
  );
}

export async function getResourceFilesByFileId(
  db: D1Database,
  fileId: string,
): Promise<ResourceFileRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM resource_files WHERE file_id = ? ORDER BY resource_id ASC, sort_order ASC, id ASC',
    )
    .bind(fileId)
    .all<ResourceFileRow>();
  return result.results;
}

export async function getResourceByFileId(
  db: D1Database,
  fileId: string,
): Promise<ResourceRow | null> {
  return db
    .prepare(
      `SELECT r.* FROM resources r
       INNER JOIN resource_files rf ON rf.resource_id = r.id
       WHERE rf.file_id = ? ORDER BY rf.sort_order ASC, rf.id ASC LIMIT 1`,
    )
    .bind(fileId)
    .first<ResourceRow>();
}

// ---------- 下载记录 ----------

export interface DownloadListOptions {
  page?: number;
  pageSize?: number;
  userId?: number;
  resourceId?: number;
}

export async function recordDownload(
  db: D1Database,
  userId: number,
  resourceId: number,
  timestamp = utcNow(),
): Promise<boolean> {
  // 每次获取都记录时间用于时段统计，同时累加资源下载计数
  const results = await db.batch<Record<string, unknown>>([
    db
      .prepare('INSERT INTO downloads (user_id, resource_id, created_at) VALUES (?, ?, ?)')
      .bind(userId, resourceId, timestamp),
    db
      .prepare('UPDATE resources SET download_count = download_count + 1 WHERE id = ?')
      .bind(resourceId),
  ]);
  return results[0].meta.changes > 0;
}

export async function recordDownloadIfAbsent(
  db: D1Database,
  userId: number,
  resourceId: number,
  timestamp = utcNow(),
): Promise<boolean> {
  if (await hasDownloaded(db, userId, resourceId)) {
    return false;
  }
  return recordDownload(db, userId, resourceId, timestamp);
}

export async function hasDownloaded(
  db: D1Database,
  userId: number,
  resourceId: number,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS found FROM downloads WHERE user_id = ? AND resource_id = ? LIMIT 1')
    .bind(userId, resourceId)
    .first<{ found: number }>();
  return row !== null;
}

export async function listDownloads(
  db: D1Database,
  options: DownloadListOptions = {},
): Promise<DownloadRow[]> {
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (options.userId !== undefined) {
    conditions.push('d.user_id = ?');
    values.push(options.userId);
  }
  if (options.resourceId !== undefined) {
    conditions.push('d.resource_id = ?');
    values.push(options.resourceId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const page = Math.max(options.page ?? 1, 1);
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;
  const result = await db
    .prepare(
      `SELECT d.id, d.user_id, d.resource_id, d.created_at, r.title, r.short_code, u.username
       FROM downloads d
       INNER JOIN resources r ON r.id = d.resource_id
       LEFT JOIN users u ON u.user_id = d.user_id
       ${where}
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(...values, pageSize, offset)
    .all<DownloadRow>();
  return result.results;
}

export async function countDownloads(
  db: D1Database,
  from?: string,
  to?: string,
): Promise<number> {
  const conditions: string[] = [];
  const values: string[] = [];
  if (from) {
    conditions.push('created_at >= ?');
    values.push(from);
  }
  if (to) {
    conditions.push('created_at < ?');
    values.push(to);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM downloads ${where}`)
    .bind(...values)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function countDownloadsByUser(db: D1Database, userId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM downloads WHERE user_id = ?')
    .bind(userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function countUniqueDownloadUsers(
  db: D1Database,
  resourceId: number,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(DISTINCT user_id) AS count FROM downloads WHERE resource_id = ?')
    .bind(resourceId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getUserDownloadedResourceIds(
  db: D1Database,
  userId: number,
): Promise<number[]> {
  const result = await db
    .prepare('SELECT DISTINCT resource_id FROM downloads WHERE user_id = ?')
    .bind(userId)
    .all<{ resource_id: number }>();
  return result.results.map((row) => row.resource_id);
}

export async function getUserPurchasedResources(
  db: D1Database,
  userId: number,
): Promise<ResourceRow[]> {
  // “我已购买的资源”只展示付费资源
  const result = await db
    .prepare(
      `SELECT r.* FROM resources r
       INNER JOIN downloads d ON d.resource_id = r.id
       WHERE d.user_id = ? AND r.is_paid = 1
       ORDER BY d.created_at DESC`,
    )
    .bind(userId)
    .all<ResourceRow>();
  return result.results;
}

// ---------- 购买记录 ----------

export interface PurchaseCreateInput {
  userId: number;
  resourceId: number;
  price: number;
  createdAt?: string;
}

export interface PurchasedResourceListOptions {
  page?: number;
  pageSize?: number;
}

export async function createPurchase(
  db: D1Database,
  input: PurchaseCreateInput,
): Promise<PurchaseRow> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO purchases (user_id, resource_id, price, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(input.userId, input.resourceId, input.price, input.createdAt ?? utcNow())
    .run();
  const row = await db
    .prepare('SELECT * FROM purchases WHERE user_id = ? AND resource_id = ?')
    .bind(input.userId, input.resourceId)
    .first<PurchaseRow>();
  if (!row) {
    throw new Error('创建购买记录后读取失败');
  }
  return row;
}

export async function getPurchase(
  db: D1Database,
  userId: number,
  resourceId: number,
): Promise<PurchaseRow | null> {
  return db
    .prepare('SELECT * FROM purchases WHERE user_id = ? AND resource_id = ?')
    .bind(userId, resourceId)
    .first<PurchaseRow>();
}

export async function hasPurchased(
  db: D1Database,
  userId: number,
  resourceId: number,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS found FROM purchases WHERE user_id = ? AND resource_id = ? LIMIT 1')
    .bind(userId, resourceId)
    .first<{ found: number }>();
  return row !== null;
}

export async function listPurchasedResources(
  db: D1Database,
  userId: number,
  options: PurchasedResourceListOptions = {},
): Promise<ResourceRow[]> {
  const page = Math.max(options.page ?? 1, 1);
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;
  const result = await db
    .prepare(
      `SELECT r.* FROM purchases p
       INNER JOIN resources r ON r.id = p.resource_id
       WHERE p.user_id = ? AND r.is_paid = 1
       ORDER BY r.sequence ASC, r.id ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(userId, pageSize, offset)
    .all<ResourceRow>();
  return result.results;
}

export async function countPurchasedResources(db: D1Database, userId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM purchases p
       INNER JOIN resources r ON r.id = p.resource_id
       WHERE p.user_id = ? AND r.is_paid = 1`,
    )
    .bind(userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

// ---------- 签到 ----------

export async function checkIn(
  db: D1Database,
  userId: number,
  date = utcToday(),
): Promise<boolean> {
  const result = await db
    .prepare('INSERT OR IGNORE INTO checkins (user_id, date) VALUES (?, ?)')
    .bind(userId, date)
    .run();
  return result.meta.changes > 0;
}

export async function hasCheckedIn(
  db: D1Database,
  userId: number,
  date = utcToday(),
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS found FROM checkins WHERE user_id = ? AND date = ? LIMIT 1')
    .bind(userId, date)
    .first<{ found: number }>();
  return row !== null;
}

export async function listCheckinsByUser(
  db: D1Database,
  userId: number,
  limit = 30,
): Promise<CheckinRow[]> {
  const result = await db
    .prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY date DESC LIMIT ?')
    .bind(userId, limit)
    .all<CheckinRow>();
  return result.results;
}

export async function countCheckinsByUser(db: D1Database, userId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM checkins WHERE user_id = ?')
    .bind(userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function countCheckinsByDate(db: D1Database, date: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM checkins WHERE date = ?')
    .bind(date)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function resetCheckinsByDate(db: D1Database, date: string): Promise<number> {
  const result = await db.prepare('DELETE FROM checkins WHERE date = ?').bind(date).run();
  return result.meta.changes;
}

export async function resetCheckinsBeforeDate(db: D1Database, date: string): Promise<number> {
  const result = await db.prepare('DELETE FROM checkins WHERE date < ?').bind(date).run();
  return result.meta.changes;
}

// ---------- 广播 ----------

export interface BroadcastCreateInput {
  content: string;
  type?: BroadcastType;
  scheduledAt?: string;
  createdBy?: number;
}

export interface BroadcastProgressPatch {
  totalCount?: number;
  successCount?: number;
  failCount?: number;
  skipCount?: number;
}

export interface BroadcastListOptions {
  page?: number;
  pageSize?: number;
  status?: BroadcastStatus;
}

export async function createBroadcast(db: D1Database, input: BroadcastCreateInput): Promise<BroadcastRow> {
  const now = utcNow();
  const result = await db
    .prepare(
      `INSERT INTO broadcasts (content, type, scheduled_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(input.content, input.type ?? 'now', input.scheduledAt ?? now, input.createdBy ?? 0, now, now)
    .run();
  const row = await db
    .prepare('SELECT * FROM broadcasts WHERE id = ?')
    .bind(result.meta.last_row_id)
    .first<BroadcastRow>();
  if (!row) {
    throw new Error('创建广播后读取失败');
  }
  return row;
}

export async function getBroadcast(db: D1Database, broadcastId: number): Promise<BroadcastRow | null> {
  return db.prepare('SELECT * FROM broadcasts WHERE id = ?').bind(broadcastId).first<BroadcastRow>();
}

export async function listBroadcasts(
  db: D1Database,
  options: BroadcastListOptions = {},
): Promise<BroadcastRow[]> {
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (options.status !== undefined) {
    conditions.push('status = ?');
    values.push(options.status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const page = Math.max(options.page ?? 1, 1);
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;
  const result = await db
    .prepare(
      `SELECT * FROM broadcasts ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...values, pageSize, offset)
    .all<BroadcastRow>();
  return result.results;
}

export async function countBroadcasts(
  db: D1Database,
  status?: BroadcastStatus,
): Promise<number> {
  const row =
    status !== undefined
      ? await db
          .prepare('SELECT COUNT(*) AS count FROM broadcasts WHERE status = ?')
          .bind(status)
          .first<{ count: number }>()
      : await db.prepare('SELECT COUNT(*) AS count FROM broadcasts').first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getDueBroadcasts(db: D1Database, now = utcNow()): Promise<BroadcastRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM broadcasts
       WHERE status IN ('pending', 'scheduled') AND scheduled_at IS NOT NULL AND scheduled_at <= ?
       ORDER BY scheduled_at ASC`,
    )
    .bind(now)
    .all<BroadcastRow>();
  return result.results;
}

export async function updateBroadcastStatus(
  db: D1Database,
  broadcastId: number,
  status: BroadcastStatus,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE broadcasts SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, utcNow(), broadcastId)
    .run();
  return result.meta.changes > 0;
}

export async function claimBroadcastForSending(
  db: D1Database,
  broadcastId: number,
): Promise<boolean> {
  // 只有 pending/scheduled 状态可抢占为 sending，避免同一广播被重复执行。
  const result = await db
    .prepare(
      `UPDATE broadcasts SET status = 'sending', updated_at = ?
       WHERE id = ? AND status IN ('pending', 'scheduled')`,
    )
    .bind(utcNow(), broadcastId)
    .run();
  return result.meta.changes > 0;
}

export async function updateBroadcastProgress(
  db: D1Database,
  broadcastId: number,
  patch: BroadcastProgressPatch,
): Promise<BroadcastRow | null> {
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (patch.totalCount !== undefined) {
    sets.push('total_count = ?');
    values.push(patch.totalCount);
  }
  if (patch.successCount !== undefined) {
    sets.push('success_count = ?');
    values.push(patch.successCount);
  }
  if (patch.failCount !== undefined) {
    sets.push('fail_count = ?');
    values.push(patch.failCount);
  }
  if (patch.skipCount !== undefined) {
    sets.push('skip_count = ?');
    values.push(patch.skipCount);
  }
  if (sets.length === 0) {
    return getBroadcast(db, broadcastId);
  }
  sets.push('updated_at = ?');
  values.push(utcNow());
  const result = await db
    .prepare(`UPDATE broadcasts SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, broadcastId)
    .run();
  return result.meta.changes > 0 ? getBroadcast(db, broadcastId) : null;
}

export async function finishBroadcast(
  db: D1Database,
  broadcastId: number,
  status: Exclude<BroadcastStatus, 'pending' | 'sending'>,
): Promise<BroadcastRow | null> {
  const result = await db
    .prepare('UPDATE broadcasts SET status = ?, finished_at = ?, updated_at = ? WHERE id = ?')
    .bind(status, utcNow(), utcNow(), broadcastId)
    .run();
  return result.meta.changes > 0 ? getBroadcast(db, broadcastId) : null;
}

export async function rescheduleBroadcast(
  db: D1Database,
  broadcastId: number,
  nextScheduledAt: string,
): Promise<BroadcastRow | null> {
  // 定时广播（每日/每周/每月）执行后安排下一次，并清零本轮进度
  const result = await db
    .prepare(
      `UPDATE broadcasts
       SET scheduled_at = ?, status = 'pending', total_count = 0,
           success_count = 0, fail_count = 0, skip_count = 0, finished_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(nextScheduledAt, utcNow(), broadcastId)
    .run();
  return result.meta.changes > 0 ? getBroadcast(db, broadcastId) : null;
}

export async function cancelBroadcast(db: D1Database, broadcastId: number): Promise<boolean> {
  const result = await db
    .prepare("UPDATE broadcasts SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ?")
    .bind(utcNow(), utcNow(), broadcastId)
    .run();
  return result.meta.changes > 0;
}

// ---------- 广告 ----------

export interface AdCreateInput {
  position: AdPosition;
  content: string;
  weight?: number;
  enabled?: boolean;
}

export interface AdUpdateInput {
  position?: AdPosition;
  content?: string;
  weight?: number;
  enabled?: boolean;
}

export interface AdListOptions {
  page?: number;
  pageSize?: number;
  position?: AdPosition;
  enabled?: boolean;
}

export async function createAd(db: D1Database, input: AdCreateInput): Promise<AdRow> {
  const now = utcNow();
  const result = await db
    .prepare(
      `INSERT INTO ads (position, content, weight, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(input.position, input.content, input.weight ?? 1, input.enabled === false ? 0 : 1, now, now)
    .run();
  const row = await db
    .prepare('SELECT * FROM ads WHERE id = ?')
    .bind(result.meta.last_row_id)
    .first<AdRow>();
  if (!row) {
    throw new Error('创建广告后读取失败');
  }
  return row;
}

export async function getAd(db: D1Database, adId: number): Promise<AdRow | null> {
  return db.prepare('SELECT * FROM ads WHERE id = ?').bind(adId).first<AdRow>();
}

export async function listAds(db: D1Database, options: AdListOptions = {}): Promise<AdRow[]> {
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (options.position !== undefined) {
    conditions.push('position = ?');
    values.push(options.position);
  }
  if (options.enabled !== undefined) {
    conditions.push('enabled = ?');
    values.push(options.enabled ? 1 : 0);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const page = Math.max(options.page ?? 1, 1);
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;
  const result = await db
    .prepare(`SELECT * FROM ads ${where} ORDER BY id ASC LIMIT ? OFFSET ?`)
    .bind(...values, pageSize, offset)
    .all<AdRow>();
  return result.results;
}

export async function countAds(
  db: D1Database,
  options: { position?: AdPosition; enabled?: boolean } = {},
): Promise<number> {
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (options.position !== undefined) {
    conditions.push('position = ?');
    values.push(options.position);
  }
  if (options.enabled !== undefined) {
    conditions.push('enabled = ?');
    values.push(options.enabled ? 1 : 0);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM ads ${where}`)
    .bind(...values)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function updateAd(
  db: D1Database,
  adId: number,
  patch: AdUpdateInput,
): Promise<AdRow | null> {
  const sets: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  if (patch.position !== undefined) {
    sets.push('position = ?');
    values.push(patch.position);
  }
  if (patch.content !== undefined) {
    sets.push('content = ?');
    values.push(patch.content);
  }
  if (patch.weight !== undefined) {
    sets.push('weight = ?');
    values.push(patch.weight);
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = ?');
    values.push(patch.enabled ? 1 : 0);
  }
  if (sets.length === 0) {
    return getAd(db, adId);
  }
  sets.push('updated_at = ?');
  values.push(utcNow());
  const result = await db
    .prepare(`UPDATE ads SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, adId)
    .run();
  return result.meta.changes > 0 ? getAd(db, adId) : null;
}

export async function deleteAd(db: D1Database, adId: number): Promise<boolean> {
  const result = await db.prepare('DELETE FROM ads WHERE id = ?').bind(adId).run();
  return result.meta.changes > 0;
}

export async function getAvailableAds(db: D1Database, position: AdPosition): Promise<AdRow[]> {
  const result = await db
    .prepare('SELECT * FROM ads WHERE position = ? AND enabled = 1 ORDER BY id ASC')
    .bind(position)
    .all<AdRow>();
  return result.results;
}

export async function getRandomAdByPosition(
  db: D1Database,
  position: AdPosition,
): Promise<AdRow | null> {
  const ads = await getAvailableAds(db, position);
  if (ads.length === 0) {
    return null;
  }
  const totalWeight = ads.reduce((sum, ad) => sum + Math.max(ad.weight, 0), 0);
  if (totalWeight <= 0) {
    return ads[Math.floor(Math.random() * ads.length)] ?? null;
  }
  // 按权重随机轮换：权重越大命中概率越高
  let cursor = Math.random() * totalWeight;
  for (const ad of ads) {
    cursor -= Math.max(ad.weight, 0);
    if (cursor <= 0) {
      return ad;
    }
  }
  return ads[ads.length - 1] ?? null;
}

// ---------- 广告消息 ----------

export interface AdMessageInput {
  text?: string;
  mediaFileId?: string | null;
  mediaUniqueId?: string | null;
  mediaType?: string;
  buttons?: AdButton[];
}

export function parseAdButtons(raw: string | null | undefined): AdButton[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is AdButton =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as AdButton).text === 'string' &&
          (item as AdButton).text.length > 0 &&
          typeof (item as AdButton).url === 'string' &&
          (item as AdButton).url.length > 0,
      )
      .map((item) => ({ text: item.text, url: item.url }));
  } catch {
    return [];
  }
}

export async function saveAdMessage(
  db: D1Database,
  adId: number,
  input: AdMessageInput = {},
): Promise<AdMessageRow> {
  const now = utcNow();
  await db
    .prepare(
      `INSERT INTO ad_messages
         (ad_id, text, media_file_id, media_unique_id, media_type, buttons, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ad_id) DO UPDATE SET
         text = excluded.text,
         media_file_id = excluded.media_file_id,
         media_unique_id = excluded.media_unique_id,
         media_type = excluded.media_type,
         buttons = excluded.buttons,
         updated_at = excluded.updated_at`,
    )
    .bind(
      adId,
      input.text ?? '',
      input.mediaFileId ?? null,
      input.mediaUniqueId ?? null,
      input.mediaType ?? '',
      JSON.stringify(input.buttons ?? []),
      now,
      now,
    )
    .run();
  const row = await getAdMessage(db, adId);
  if (!row) {
    throw new Error('保存广告消息后读取失败');
  }
  return row;
}

export async function getAdMessage(db: D1Database, adId: number): Promise<AdMessageRow | null> {
  return db.prepare('SELECT * FROM ad_messages WHERE ad_id = ?').bind(adId).first<AdMessageRow>();
}

export async function getAdMessageButtons(db: D1Database, adId: number): Promise<AdButton[]> {
  const message = await getAdMessage(db, adId);
  return parseAdButtons(message?.buttons);
}

export async function listAdMessagesByAdIds(
  db: D1Database,
  adIds: number[],
): Promise<AdMessageRow[]> {
  if (adIds.length === 0) {
    return [];
  }
  const placeholders = adIds.map(() => '?').join(', ');
  const result = await db
    .prepare(
      `SELECT * FROM ad_messages
       WHERE ad_id IN (${placeholders})
       ORDER BY ad_id ASC`,
    )
    .bind(...adIds)
    .all<AdMessageRow>();
  return result.results;
}

export interface AdMessageUpdateInput {
  text?: string;
  mediaFileId?: string | null;
  mediaUniqueId?: string | null;
  mediaType?: string;
  buttons?: AdButton[];
}

/** 局部更新 ad_messages：仅在传入字段时写入，避免覆盖未修改的广告内容。 */
export async function updateAdMessage(
  db: D1Database,
  adId: number,
  patch: AdMessageUpdateInput,
): Promise<AdMessageRow | null> {
  const existing = await getAdMessage(db, adId);
  const now = utcNow();
  if (!existing) {
    await db
      .prepare(
        `INSERT INTO ad_messages
           (ad_id, text, media_file_id, media_unique_id, media_type, buttons, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        adId,
        patch.text ?? '',
        patch.mediaFileId ?? null,
        patch.mediaUniqueId ?? null,
        patch.mediaType ?? '',
        JSON.stringify(patch.buttons ?? []),
        now,
        now,
      )
      .run();
    return getAdMessage(db, adId);
  }

  const sets: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  if (patch.text !== undefined) {
    sets.push('text = ?');
    values.push(patch.text);
  }
  if (patch.mediaFileId !== undefined) {
    sets.push('media_file_id = ?');
    values.push(patch.mediaFileId);
  }
  if (patch.mediaUniqueId !== undefined) {
    sets.push('media_unique_id = ?');
    values.push(patch.mediaUniqueId);
  }
  if (patch.mediaType !== undefined) {
    sets.push('media_type = ?');
    values.push(patch.mediaType);
  }
  if (patch.buttons !== undefined) {
    sets.push('buttons = ?');
    values.push(JSON.stringify(patch.buttons));
  }
  if (sets.length === 0) {
    return existing;
  }
  sets.push('updated_at = ?');
  values.push(now);
  await db
    .prepare(`UPDATE ad_messages SET ${sets.join(', ')} WHERE ad_id = ?`)
    .bind(...values, adId)
    .run();
  return getAdMessage(db, adId);
}

export async function setAdMessageButtons(
  db: D1Database,
  adId: number,
  buttons: AdButton[],
): Promise<AdButton[]> {
  const now = utcNow();
  await db
    .prepare(
      `INSERT INTO ad_messages
         (ad_id, text, media_file_id, media_unique_id, media_type, buttons, created_at, updated_at)
       VALUES (?, '', NULL, NULL, '', ?, ?, ?)
       ON CONFLICT(ad_id) DO UPDATE SET
         buttons = excluded.buttons,
         updated_at = excluded.updated_at`,
    )
    .bind(adId, JSON.stringify(buttons), now, now)
    .run();
  return buttons;
}

export async function deleteAdMessage(db: D1Database, adId: number): Promise<boolean> {
  const result = await db.prepare('DELETE FROM ad_messages WHERE ad_id = ?').bind(adId).run();
  return result.meta.changes > 0;
}

// ---------- 系统设置 ----------

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function getSettings(
  db: D1Database,
  keys?: string[],
): Promise<Record<string, string>> {
  if (!keys || keys.length === 0) {
    const result = await db
      .prepare('SELECT key, value FROM settings')
      .all<{ key: string; value: string }>();
    return Object.fromEntries(result.results.map((row) => [row.key, row.value]));
  }
  const placeholders = keys.map(() => '?').join(', ');
  const result = await db
    .prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all<{ key: string; value: string }>();
  return Object.fromEntries(result.results.map((row) => [row.key, row.value]));
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, utcNow())
    .run();
}

export async function setSettings(db: D1Database, entries: Record<string, string>): Promise<void> {
  const statements = Object.entries(entries).map(([key, value]) =>
    db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(key, value, utcNow()),
  );
  await db.batch(statements);
}

export async function deleteSetting(db: D1Database, key: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
  return result.meta.changes > 0;
}

// ---------- 管理员日志 ----------

export interface AdminLogCreateInput {
  adminId: number;
  action: string;
  detail?: string;
}

export interface AdminLogListOptions {
  page?: number;
  pageSize?: number;
  adminId?: number;
  actionKeyword?: string;
}

export async function writeAdminLog(db: D1Database, input: AdminLogCreateInput): Promise<AdminLogRow> {
  const result = await db
    .prepare('INSERT INTO admin_logs (admin_id, action, detail) VALUES (?, ?, ?)')
    .bind(input.adminId, input.action, input.detail ?? '')
    .run();
  const row = await db
    .prepare('SELECT * FROM admin_logs WHERE id = ?')
    .bind(result.meta.last_row_id)
    .first<AdminLogRow>();
  if (!row) {
    throw new Error('写入管理员日志后读取失败');
  }
  return row;
}

export async function listAdminLogs(
  db: D1Database,
  options: AdminLogListOptions = {},
): Promise<AdminLogRow[]> {
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (options.adminId !== undefined) {
    conditions.push('admin_id = ?');
    values.push(options.adminId);
  }
  if (options.actionKeyword) {
    conditions.push('action LIKE ?');
    values.push(`%${options.actionKeyword}%`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const page = Math.max(options.page ?? 1, 1);
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;
  const result = await db
    .prepare(`SELECT * FROM admin_logs ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(...values, pageSize, offset)
    .all<AdminLogRow>();
  return result.results;
}

export async function countAdminLogs(
  db: D1Database,
  options: { adminId?: number; actionKeyword?: string } = {},
): Promise<number> {
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (options.adminId !== undefined) {
    conditions.push('admin_id = ?');
    values.push(options.adminId);
  }
  if (options.actionKeyword) {
    conditions.push('action LIKE ?');
    values.push(`%${options.actionKeyword}%`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM admin_logs ${where}`)
    .bind(...values)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

// ---------- 限流 ----------

export async function getRateLimit(
  db: D1Database,
  userId: number,
  resourceId: number,
): Promise<RateLimitRow | null> {
  return db
    .prepare('SELECT * FROM rate_limits WHERE user_id = ? AND resource_id = ?')
    .bind(userId, resourceId)
    .first<RateLimitRow>();
}

export async function setRateLimit(
  db: D1Database,
  userId: number,
  resourceId: number,
  timestamp = utcNow(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rate_limits (user_id, resource_id, last_request) VALUES (?, ?, ?)
       ON CONFLICT(user_id, resource_id) DO UPDATE SET last_request = excluded.last_request`,
    )
    .bind(userId, resourceId, timestamp)
    .run();
}

export async function deleteRateLimit(
  db: D1Database,
  userId: number,
  resourceId: number,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM rate_limits WHERE user_id = ? AND resource_id = ?')
    .bind(userId, resourceId)
    .run();
  return result.meta.changes > 0;
}

export async function clearExpiredRateLimits(db: D1Database, before: string): Promise<number> {
  const result = await db.prepare('DELETE FROM rate_limits WHERE last_request < ?').bind(before).run();
  return result.meta.changes;
}

// ---------- 积分流水 ----------

export interface PointsLogCreateInput {
  userId: number;
  change: number;
  balanceAfter: number;
  reason: string;
  relatedId?: number | null;
}

export interface PointsLogListOptions {
  page?: number;
  pageSize?: number;
  userId?: number;
}

export async function addPointsLog(db: D1Database, input: PointsLogCreateInput): Promise<PointsLogRow> {
  const result = await db
    .prepare(
      `INSERT INTO points_logs (user_id, change, balance_after, reason, related_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(input.userId, input.change, input.balanceAfter, input.reason, input.relatedId ?? null)
    .run();
  const row = await db
    .prepare('SELECT * FROM points_logs WHERE id = ?')
    .bind(result.meta.last_row_id)
    .first<PointsLogRow>();
  if (!row) {
    throw new Error('写入积分流水后读取失败');
  }
  return row;
}

export async function listPointsLogs(
  db: D1Database,
  options: PointsLogListOptions = {},
): Promise<PointsLogRow[]> {
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (options.userId !== undefined) {
    conditions.push('user_id = ?');
    values.push(options.userId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const page = Math.max(options.page ?? 1, 1);
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;
  const result = await db
    .prepare(`SELECT * FROM points_logs ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(...values, pageSize, offset)
    .all<PointsLogRow>();
  return result.results;
}

export async function countPointsLogs(
  db: D1Database,
  userId?: number,
): Promise<number> {
  const row =
    userId !== undefined
      ? await db
          .prepare('SELECT COUNT(*) AS count FROM points_logs WHERE user_id = ?')
          .bind(userId)
          .first<{ count: number }>()
      : await db.prepare('SELECT COUNT(*) AS count FROM points_logs').first<{ count: number }>();
  return row?.count ?? 0;
}

// ---------- 统计 ----------

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

function fillDailySeries(rows: DailyCountRow[], days: number): DailyCountRow[] {
  const byDate = new Map(rows.map((row) => [row.date, row.count]));
  const series: DailyCountRow[] = [];
  const now = new Date();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
    series.push({ date, count: byDate.get(date) ?? 0 });
  }
  return series;
}

export async function getDashboardOverview(db: D1Database): Promise<DashboardOverview> {
  const today = utcToday();
  const todayStart = `${today}T00:00:00.000Z`;
  const tomorrowStart = startOfNextUtcDay();
  const results = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT COUNT(*) AS value FROM users'),
    db.prepare('SELECT COUNT(*) AS value FROM resources'),
    db.prepare('SELECT COUNT(*) AS value FROM downloads'),
    db.prepare('SELECT COUNT(*) AS value FROM users WHERE is_banned = 1'),
    db
      .prepare('SELECT COUNT(*) AS value FROM users WHERE created_at >= ? AND created_at < ?')
      .bind(todayStart, tomorrowStart),
    db
      .prepare(
        'SELECT COUNT(DISTINCT user_id) AS value FROM users WHERE last_active >= ? AND last_active < ?',
      )
      .bind(todayStart, tomorrowStart),
    db
      .prepare('SELECT COUNT(*) AS value FROM downloads WHERE created_at >= ? AND created_at < ?')
      .bind(todayStart, tomorrowStart),
    db.prepare('SELECT COUNT(*) AS value FROM checkins WHERE date = ?').bind(today),
    db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN change > 0 THEN change ELSE 0 END), 0) AS issued,
         COALESCE(SUM(CASE WHEN change < 0 THEN ABS(change) ELSE 0 END), 0) AS spent
       FROM points_logs`,
    ),
  ]);
  const readCount = (index: number): number => Number(results[index].results[0]?.value ?? 0);
  const points = results[8].results[0] as { issued: number; spent: number };
  return {
    totalUsers: readCount(0),
    totalResources: readCount(1),
    totalDownloads: readCount(2),
    bannedUsers: readCount(3),
    todayNewUsers: readCount(4),
    todayActiveUsers: readCount(5),
    todayDownloads: readCount(6),
    todayCheckins: readCount(7),
    totalPointsIssued: Number(points.issued ?? 0),
    totalPointsSpent: Number(points.spent ?? 0),
  };
}

export async function getNewUsersByDay(db: D1Database, days = 7): Promise<DailyCountRow[]> {
  const since = daysAgoIso(days - 1);
  const result = await db
    .prepare(
      `SELECT date(created_at) AS date, COUNT(*) AS count
       FROM users WHERE created_at >= ?
       GROUP BY date(created_at) ORDER BY date ASC`,
    )
    .bind(since)
    .all<DailyCountRow>();
  return fillDailySeries(result.results, days);
}

export async function getActiveUsersByDay(db: D1Database, days = 7): Promise<DailyCountRow[]> {
  const since = daysAgoIso(days - 1);
  const result = await db
    .prepare(
      `SELECT date(last_active) AS date, COUNT(DISTINCT user_id) AS count
       FROM users WHERE last_active IS NOT NULL AND last_active >= ?
       GROUP BY date(last_active) ORDER BY date ASC`,
    )
    .bind(since)
    .all<DailyCountRow>();
  return fillDailySeries(result.results, days);
}

export async function getDownloadsByDay(db: D1Database, days = 7): Promise<DailyCountRow[]> {
  const since = daysAgoIso(days - 1);
  const result = await db
    .prepare(
      `SELECT date(created_at) AS date, COUNT(*) AS count
       FROM downloads WHERE created_at >= ?
       GROUP BY date(created_at) ORDER BY date ASC`,
    )
    .bind(since)
    .all<DailyCountRow>();
  return fillDailySeries(result.results, days);
}

export async function getHourlyDownloadStats(
  db: D1Database,
  hours = 24,
): Promise<HourlyCountRow[]> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const result = await db
    .prepare(
      `SELECT strftime('%Y-%m-%d %H:00', created_at) AS hour, COUNT(*) AS count
       FROM downloads WHERE created_at >= ?
       GROUP BY hour ORDER BY hour ASC`,
    )
    .bind(since)
    .all<HourlyCountRow>();
  const byHour = new Map(result.results.map((row) => [row.hour, row.count]));
  const series: HourlyCountRow[] = [];
  const now = new Date();
  for (let offset = hours - 1; offset >= 0; offset -= 1) {
    const label = hourLabel(new Date(now.getTime() - offset * 3_600_000));
    series.push({ hour: label, count: byHour.get(label) ?? 0 });
  }
  return series;
}

export async function getDownloadActivityByHour(
  db: D1Database,
  days = 7,
): Promise<HourlyActivityRow[]> {
  const since = daysAgoIso(days - 1);
  const result = await db
    .prepare(
      `SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS count
       FROM downloads WHERE created_at >= ?
       GROUP BY hour ORDER BY hour ASC`,
    )
    .bind(since)
    .all<HourlyActivityRow>();
  const byHour = new Map(result.results.map((row) => [row.hour, row.count]));
  return Array.from({ length: 24 }, (_, hour) => ({ hour, count: byHour.get(hour) ?? 0 }));
}

export async function getPointsCycleStats(db: D1Database): Promise<PointsCycleStats> {
  const totals = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN change > 0 THEN change ELSE 0 END), 0) AS issued,
         COALESCE(SUM(CASE WHEN change < 0 THEN ABS(change) ELSE 0 END), 0) AS spent,
         COALESCE(SUM(change), 0) AS net
       FROM points_logs`,
    )
    .first<{ issued: number; spent: number; net: number }>();
  const reasons = await db
    .prepare(
      `SELECT reason, SUM(change) AS total_change, COUNT(*) AS count
       FROM points_logs GROUP BY reason ORDER BY total_change DESC, reason ASC`,
    )
    .all<{ reason: string; total_change: number; count: number }>();
  return {
    issued: Number(totals?.issued ?? 0),
    spent: Number(totals?.spent ?? 0),
    net: Number(totals?.net ?? 0),
    byReason: reasons.results.map((row) => ({
      reason: row.reason,
      totalChange: Number(row.total_change ?? 0),
      count: Number(row.count ?? 0),
    })),
  };
}

export async function getTopDownloadedResources(
  db: D1Database,
  limit = 10,
): Promise<ResourceRow[]> {
  const result = await db
    .prepare('SELECT * FROM resources ORDER BY download_count DESC, id DESC LIMIT ?')
    .bind(limit)
    .all<ResourceRow>();
  return result.results;
}
