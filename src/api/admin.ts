/**
 * 管理后台 REST API（/api/admin）。
 * 登录使用 bcrypt + 连续失败锁定；其余接口要求 Bearer JWT。
 * 支持可选 IP 白名单与 CORS 预检，错误统一返回 {"error":"..."}。
 */

import {
  addPointsLog,
  banUser,
  countResourceFilesByResourceIds,
  countAdminLogs,
  countBroadcasts,
  countCheckinsByDate,
  countDownloads,
  countDownloadsByUser,
  countInvitedUsers,
  countPointsLogs,
  countResources,
  countUsers,
  countAds,
  createAd,
  createResource,
  deleteAd,
  deleteResource,
  getAd,
  getAdMessage,
  getResourceById,
  getPointsCycleStats,
  getSettings,
  getUser,
  getUserStats,
  listAds,
  listAdMessagesByAdIds,
  listAdminLogs,
  listDownloads,
  listPointsLogs,
  listResources,
  listUsers,
  parseAdButtons,
  saveAdMessage,
  setSettings,
  setUserPoints,
  unbanUser,
  updateAd,
  updateAdMessage,
  updateResource,
  writeAdminLog,
  type AdMessageRow,
  type AdMessageUpdateInput,
  type AdRow,
  type AdUpdateInput,
  type ResourceFileInput,
  type ResourceListOptions,
  type ResourceUpdateInput,
} from '../db/queries';
import { getSevenDayTrend, getTwentyFourHourStats } from '../services/stats';
import {
  attemptAdminLogin,
  DEFAULT_JWT_TTL,
  isIpAllowed,
  verifyAdminToken,
} from '../utils/auth';
import {
  AppError,
  errorMessage,
  extractClientIp,
  jsonResponse,
  parseCsv,
  parsePagination,
  utcToday,
} from '../utils/helpers';
import { generateUniqueShortCode } from '../utils/shortcode';
import type { AdminJwtPayload, AdButton, AdPosition, Env } from '../types';

const ADMIN_API_PREFIX = '/api/admin';
const ADMIN_ADJUST_REASON = 'admin_adjust';
const DEFAULT_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export async function handleAdminApi(request: Request, env: Env): Promise<Response> {
  try {
    // 配置了 ADMIN_IP_WHITELIST 后，所有 /api/admin 请求（含预检）都校验客户端 IP
    if (!isIpAllowed(env, extractClientIp(request))) {
      return adminError('访问被拒绝：客户端 IP 不在白名单内', 403, env, request);
    }

    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method === 'OPTIONS') {
      // 未配置 ADMIN_CORS_ORIGIN 时不返回跨域头（同源部署无需 CORS）；
      // 已配置但 Origin 不在白名单内时拒绝预检。
      if (env.ADMIN_CORS_ORIGIN?.trim() && !isOriginAllowed(env, request)) {
        return adminError('Origin 不在 CORS 白名单内', 403, env, request);
      }
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    const path =
      url.pathname === ADMIN_API_PREFIX ? '/' : url.pathname.slice(ADMIN_API_PREFIX.length);
    if (!path.startsWith('/')) {
      return adminError('Not Found', 404, env, request);
    }

    if (path === '/login') {
      if (method !== 'POST') {
        return methodNotAllowed(env, request, ['POST']);
      }
      return await handleLogin(request, env);
    }

    const admin = await requireAdmin(request, env);
    const segments = path.split('/').filter(Boolean);

    if (segments[0] === 'dashboard' && segments.length === 1) {
      if (method !== 'GET') {
        return methodNotAllowed(env, request, ['GET']);
      }
      return await handleDashboard(request, env);
    }

    if (segments[0] === 'resources' && segments.length === 1) {
      if (method === 'GET') {
        return await handleListResources(request, env);
      }
      if (method === 'POST') {
        return await handleCreateResource(request, env, admin);
      }
      return methodNotAllowed(env, request, ['GET', 'POST']);
    }

    if (segments[0] === 'resources' && segments.length === 2) {
      const resourceId = parseId(segments[1], '资源');
      if (method === 'PATCH') {
        return await handleUpdateResource(request, env, admin, resourceId);
      }
      if (method === 'DELETE') {
        return await handleDeleteResource(request, env, admin, resourceId);
      }
      return methodNotAllowed(env, request, ['PATCH', 'DELETE']);
    }

    if (segments[0] === 'users' && segments.length === 1) {
      if (method !== 'GET') {
        return methodNotAllowed(env, request, ['GET']);
      }
      return await handleListUsers(request, env);
    }

    if (segments[0] === 'users' && segments.length === 3) {
      const userId = parseId(segments[1], '用户');
      if (segments[2] === 'logs' && method === 'GET') {
        return await handleUserPointsLogs(request, env, userId);
      }
      if (segments[2] === 'downloads' && method === 'GET') {
        return await handleUserDownloads(request, env, userId);
      }
      if (segments[2] === 'stats' && method === 'GET') {
        return await handleUserStats(request, env, userId);
      }
      return methodNotAllowed(env, request, ['GET']);
    }

    if (segments[0] === 'users' && segments.length === 2) {
      if (method !== 'PATCH') {
        return methodNotAllowed(env, request, ['PATCH']);
      }
      return await handleUpdateUser(request, env, admin, parseId(segments[1], '用户'));
    }

    if (segments[0] === 'settings' && segments.length === 1) {
      if (method === 'GET') {
        return await handleGetSettings(request, env);
      }
      if (method === 'PATCH') {
        return await handlePatchSettings(request, env, admin);
      }
      return methodNotAllowed(env, request, ['GET', 'PATCH']);
    }

    if (segments[0] === 'ads' && segments.length === 1) {
      if (method === 'GET') {
        return await handleListAds(request, env);
      }
      if (method === 'POST') {
        return await handleCreateAd(request, env, admin);
      }
      return methodNotAllowed(env, request, ['GET', 'POST']);
    }

    if (segments[0] === 'ads' && segments.length === 2) {
      const adId = parseId(segments[1], '广告');
      if (method === 'PATCH') {
        return await handleUpdateAd(request, env, admin, adId);
      }
      if (method === 'DELETE') {
        return await handleDeleteAd(request, env, admin, adId);
      }
      return methodNotAllowed(env, request, ['PATCH', 'DELETE']);
    }

    if (segments[0] === 'logs' && segments.length === 1) {
      if (method !== 'GET') {
        return methodNotAllowed(env, request, ['GET']);
      }
      return await handleListLogs(request, env);
    }

    return adminError('Not Found', 404, env, request);
  } catch (err) {
    if (err instanceof AppError) {
      return adminError(err.message, err.statusCode, env, request);
    }
    console.error('[admin-api] unexpected error', errorMessage(err));
    return adminError('服务器内部错误', 500, env, request);
  }
}

// ---------- 响应与 CORS ----------

/** 校验请求 Origin 是否在 ADMIN_CORS_ORIGIN 配置内；未配置时返回 null（不跨域开放）。 */
function isOriginAllowed(env: Env, request: Request): string | null {
  const configured = env.ADMIN_CORS_ORIGIN?.trim();
  if (!configured) {
    return null;
  }
  if (configured === '*') {
    return '*';
  }
  const origin = request.headers.get('Origin');
  if (!origin) {
    return null;
  }
  return parseCsv(configured).includes(origin) ? origin : null;
}

function corsHeaders(env: Env, request: Request): Headers {
  const headers = new Headers();
  const origin = isOriginAllowed(env, request);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  return headers;
}

function adminJson(
  data: unknown,
  status: number,
  env: Env,
  request: Request,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = corsHeaders(env, request);
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers.set(key, value);
    }
  }
  return jsonResponse(data, { status, headers });
}

function adminError(message: string, status: number, env: Env, request: Request): Response {
  return adminJson({ error: message }, status, env, request);
}

function methodNotAllowed(env: Env, request: Request, allow: string[]): Response {
  return adminJson({ error: 'Method Not Allowed' }, 405, env, request, {
    Allow: allow.join(', '),
  });
}

// ---------- 鉴权 ----------

async function requireAdmin(request: Request, env: Env): Promise<AdminJwtPayload> {
  const header = request.headers.get('authorization')?.trim() ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim() ?? '';
  const payload = await verifyAdminToken(env, token);
  if (!payload) {
    throw new AppError('未授权或登录已过期', 401, 'UNAUTHORIZED');
  }
  return payload;
}

async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new AppError('请求体必须是合法 JSON', 400, 'BAD_REQUEST');
  }
}

function parseJwtTtlMs(value: string): number {
  const match = /^(\d+)\s*([smhd])$/i.exec(value.trim());
  if (!match) {
    return DEFAULT_TOKEN_TTL_MS;
  }
  const amount = Number(match[1]);
  const factor =
    match[2].toLowerCase() === 's'
      ? 1000
      : match[2].toLowerCase() === 'm'
        ? 60_000
        : match[2].toLowerCase() === 'h'
          ? 3_600_000
          : 86_400_000;
  return amount * factor;
}

function parseId(raw: string, label: string): number {
  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id <= 0) {
    throw new AppError(`${label} ID 必须是正整数`, 400, 'VALIDATION_ERROR');
  }
  return id;
}

async function safeWriteAdminLog(
  db: D1Database,
  adminId: number,
  action: string,
  detail: string,
): Promise<void> {
  try {
    await writeAdminLog(db, { adminId, action, detail });
  } catch (err) {
    // 操作日志失败不应阻断业务操作，仅记录到 console
    console.error('[admin-api] write admin log failed', errorMessage(err));
  }
}

// ---------- 登录 ----------

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody<{ password?: unknown }>(request);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!password) {
    throw new AppError('密码不能为空', 400, 'VALIDATION_ERROR');
  }
  const clientIp = extractClientIp(request);
  const result = await attemptAdminLogin(env, password, clientIp);
  if (!result.ok) {
    if (result.reason === 'locked') {
      throw new AppError('登录失败次数过多，账号已临时锁定', 401, 'LOCKED');
    }
    if (result.reason === 'not_configured') {
      throw new AppError('管理员密码未配置，无法登录。', 500, 'CONFIG_ERROR');
    }
    if (result.reason === 'jwt_not_configured') {
      throw new AppError(
        'JWT_SECRET 未配置，无法登录：请先在 Worker 环境变量中配置 JWT_SECRET。',
        500,
        'CONFIG_ERROR',
      );
    }
    await safeWriteAdminLog(env.DB, 0, 'login_fail', `client_ip=${clientIp ?? 'unknown'}`);
    throw new AppError('密码错误', 401, 'INVALID_PASSWORD');
  }
  const expiresAt = new Date(Date.now() + parseJwtTtlMs(DEFAULT_JWT_TTL)).toISOString();
  await safeWriteAdminLog(env.DB, result.userId, 'login', 'admin login success');
  return adminJson({ token: result.token, expiresAt }, 200, env, request);
}

// ---------- 仪表盘 ----------

async function handleDashboard(request: Request, env: Env): Promise<Response> {
  const today = utcToday();
  const now = new Date();
  const todayStart = `${today}T00:00:00.000Z`;
  const tomorrowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();

  const [users, downloadsToday, resources, broadcasts, trend, trend30, hourly, pointsCycle, todayCheckins, invites] =
    await Promise.all([
      countUsers(env.DB),
      countDownloads(env.DB, todayStart, tomorrowStart),
      countResources(env.DB),
      countBroadcasts(env.DB),
      getSevenDayTrend(env.DB, 7),
      getSevenDayTrend(env.DB, 30),
      getTwentyFourHourStats(env.DB, 7),
      getPointsCycleStats(env.DB),
      countCheckinsByDate(env.DB, today),
      countInvitedUsers(env.DB),
    ]);

  return adminJson(
    {
      totals: { users, downloadsToday, resources, broadcasts },
      trends7d: {
        dates: trend.newUsers.map((item) => item.date),
        newUsers: trend.newUsers.map((item) => item.count),
        activeUsers: trend.activeUsers.map((item) => item.count),
        downloads: trend.downloads.map((item) => item.count),
      },
      trends30d: {
        dates: trend30.newUsers.map((item) => item.date),
        newUsers: trend30.newUsers.map((item) => item.count),
        activeUsers: trend30.activeUsers.map((item) => item.count),
        downloads: trend30.downloads.map((item) => item.count),
      },
      heatmap24: hourly.hourlyActivity.map((item) => ({
        hour: item.hour,
        downloads: item.count,
      })),
      pointsCycle: {
        totalEarned: pointsCycle.issued,
        totalSpent: pointsCycle.spent,
        todayCheckins,
        invites,
      },
    },
    200,
    env,
    request,
  );
}

// ---------- 资源 ----------

async function handleListResources(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pagination = parsePagination(url.searchParams, {
    defaultPageSize: 20,
    maxPageSize: 100,
  });
  const q = url.searchParams.get('q')?.trim() || undefined;
  const sort = url.searchParams.get('sort')?.trim() || undefined;
  const order = url.searchParams.get('order')?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
  const [items, total] = await Promise.all([
    listResources(env.DB, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      keyword: q,
      sortBy: sort as ResourceListOptions['sortBy'],
      sortOrder: order,
    }),
    countResources(env.DB, { keyword: q }),
  ]);
  const fileCounts = await countResourceFilesByResourceIds(
    env.DB,
    items.map((item) => item.id),
  );
  const enrichedItems = items.map((item) => ({
    ...item,
    file_count: fileCounts[item.id] ?? (item.file_id ? 1 : 0),
  }));
  return adminJson({ items: enrichedItems, total }, 200, env, request);
}

async function handleCreateResource(
  request: Request,
  env: Env,
  admin: AdminJwtPayload,
): Promise<Response> {
  const body = await readJsonBody<Record<string, unknown>>(request);
  const files = parseResourceFiles(body.files);
  const fileIds = files.length > 0 ? files.map((file) => file.fileId) : parseFileIds(body.fileIds);
  const fileId = fileIds[0] ?? (typeof body.fileId === 'string' ? body.fileId.trim() : '');
  if (!fileId) {
    throw new AppError('fileId 不能为空', 400, 'VALIDATION_ERROR');
  }
  const normalizedFileIds = fileIds.length > 0 ? fileIds : [fileId];
  const price = parsePrice(body.price);
  const isPaid = typeof body.isPaid === 'boolean' ? body.isPaid : price > 0;
  const tags = normalizeTags(body.tags);
  const shortCode = await generateUniqueShortCode(env.DB);
  const title = normalizeTitle(body.title) || `资源 ${shortCode}`;
  // creator_id 有外键约束；管理员尚未注册为 Bot 用户时置空，避免资源创建被外键阻断
  const creator = await getUser(env.DB, admin.userId);

  const resource = await createResource(env.DB, {
    shortCode,
    fileId,
    fileUniqueId: files[0]?.fileUniqueId ?? null,
    fileIds: normalizedFileIds,
    files: files.length > 0 ? files : undefined,
    title,
    tags,
    isPaid,
    price,
    creatorId: creator ? admin.userId : null,
  });
  await safeWriteAdminLog(
    env.DB,
    admin.userId,
    'resource_create',
    `id=${resource.id} short_code=${resource.short_code} title=${title} tags=${tags} price=${price}`,
  );
  return adminJson(resource, 201, env, request);
}

async function handleUpdateResource(
  request: Request,
  env: Env,
  admin: AdminJwtPayload,
  resourceId: number,
): Promise<Response> {
  const body = await readJsonBody<Record<string, unknown>>(request);
  const patch: ResourceUpdateInput = {};

  if ('fileId' in body) {
    const fileId = typeof body.fileId === 'string' ? body.fileId.trim() : '';
    if (!fileId) {
      throw new AppError('fileId 不能为空', 400, 'VALIDATION_ERROR');
    }
    patch.fileId = fileId;
  }
  if ('fileIds' in body) {
    const fileIds = parseFileIds(body.fileIds);
    if (fileIds.length === 0) {
      throw new AppError('fileIds 不能为空', 400, 'VALIDATION_ERROR');
    }
    patch.fileIds = fileIds;
    patch.fileId = fileIds[0] ?? patch.fileId;
  }
  if ('files' in body) {
    const files = parseResourceFiles(body.files);
    if (files.length === 0) {
      throw new AppError('files 不能为空', 400, 'VALIDATION_ERROR');
    }
    patch.files = files;
    patch.fileId = files[0]?.fileId ?? patch.fileId;
  }
  if ('title' in body) {
    patch.title = normalizeTitle(body.title);
  }
  if ('tags' in body) {
    patch.tags = normalizeTags(body.tags);
  }
  if ('isPaid' in body) {
    if (typeof body.isPaid !== 'boolean') {
      throw new AppError('isPaid 必须是布尔值', 400, 'VALIDATION_ERROR');
    }
    patch.isPaid = body.isPaid;
  }
  if ('price' in body) {
    patch.price = parsePrice(body.price);
  }

  if (Object.keys(patch).length === 0) {
    const existing = await getResourceById(env.DB, resourceId);
    if (!existing) {
      throw new AppError('资源不存在', 404, 'NOT_FOUND');
    }
    return adminJson(existing, 200, env, request);
  }

  const updated = await updateResource(env.DB, resourceId, patch);
  if (!updated) {
    throw new AppError('资源不存在', 404, 'NOT_FOUND');
  }
  await safeWriteAdminLog(
    env.DB,
    admin.userId,
    'resource_update',
    `id=${resourceId} ${JSON.stringify(patch)}`,
  );
  return adminJson(updated, 200, env, request);
}

async function handleDeleteResource(
  request: Request,
  env: Env,
  admin: AdminJwtPayload,
  resourceId: number,
): Promise<Response> {
  const resource = await getResourceById(env.DB, resourceId);
  if (!resource) {
    throw new AppError('资源不存在', 404, 'NOT_FOUND');
  }
  await deleteResource(env.DB, resourceId);
  await safeWriteAdminLog(
    env.DB,
    admin.userId,
    'resource_delete',
    `id=${resourceId} short_code=${resource.short_code} title=${resource.title}`,
  );
  return adminJson({ ok: true }, 200, env, request);
}

// ---------- 用户 ----------

async function handleListUsers(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pagination = parsePagination(url.searchParams, {
    defaultPageSize: 20,
    maxPageSize: 100,
  });
  const q = url.searchParams.get('q')?.trim() || undefined;
  const [items, total] = await Promise.all([
    listUsers(env.DB, { page: pagination.page, pageSize: pagination.pageSize, keyword: q }),
    countUsers(env.DB, { keyword: q }),
  ]);
  return adminJson({ items, total }, 200, env, request);
}

async function handleUpdateUser(
  request: Request,
  env: Env,
  admin: AdminJwtPayload,
  userId: number,
): Promise<Response> {
  const body = await readJsonBody<Record<string, unknown>>(request);
  const existing = await getUser(env.DB, userId);
  if (!existing) {
    throw new AppError('用户不存在', 404, 'NOT_FOUND');
  }

  const logEntries: { action: string; detail: string }[] = [];
  if ('points' in body) {
    if (!Number.isInteger(body.points) || Number(body.points) < 0) {
      throw new AppError('points 必须是非负整数', 400, 'VALIDATION_ERROR');
    }
    const newPoints = body.points as number;
    const delta = newPoints - existing.points;
    if (delta !== 0) {
      const ok = await setUserPoints(env.DB, userId, newPoints);
      if (!ok) {
        throw new AppError('用户不存在', 404, 'NOT_FOUND');
      }
      await addPointsLog(env.DB, {
        userId,
        change: delta,
        balanceAfter: newPoints,
        reason: ADMIN_ADJUST_REASON,
      });
      logEntries.push({
        action: 'user_points',
        detail: `user_id=${userId} points=${existing.points}->${newPoints}`,
      });
    }
  }
  if ('isBanned' in body) {
    if (typeof body.isBanned !== 'boolean') {
      throw new AppError('isBanned 必须是布尔值', 400, 'VALIDATION_ERROR');
    }
    const ok = body.isBanned ? await banUser(env.DB, userId) : await unbanUser(env.DB, userId);
    if (!ok) {
      throw new AppError('用户不存在', 404, 'NOT_FOUND');
    }
    logEntries.push({
      action: body.isBanned ? 'user_ban' : 'user_unban',
      detail: `user_id=${userId}`,
    });
  }

  const updated = await getUser(env.DB, userId);
  if (!updated) {
    throw new AppError('用户不存在', 404, 'NOT_FOUND');
  }
  if (logEntries.length === 0) {
    logEntries.push({ action: 'user_update', detail: `user_id=${userId}` });
  }
  for (const entry of logEntries) {
    await safeWriteAdminLog(env.DB, admin.userId, entry.action, entry.detail);
  }
  return adminJson(updated, 200, env, request);
}

// ---------- 设置与日志 ----------

async function handleGetSettings(request: Request, env: Env): Promise<Response> {
  const settings = await getSettings(env.DB);
  return adminJson({ settings }, 200, env, request);
}

async function handlePatchSettings(
  request: Request,
  env: Env,
  admin: AdminJwtPayload,
): Promise<Response> {
  const body = await readJsonBody<Record<string, unknown>>(request);
  const rawSettings = body.settings;
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) {
    throw new AppError('settings 必须是对象', 400, 'VALIDATION_ERROR');
  }
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawSettings as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new AppError(`settings.${key} 必须是字符串`, 400, 'VALIDATION_ERROR');
    }
    entries[key] = value;
  }
  if (Object.keys(entries).length === 0) {
    throw new AppError('settings 不能为空', 400, 'VALIDATION_ERROR');
  }
  await setSettings(env.DB, entries);
  await safeWriteAdminLog(
    env.DB,
    admin.userId,
    'settings_update',
    `keys=${Object.keys(entries).join(',')}`,
  );
  return adminJson({ ok: true }, 200, env, request);
}

async function handleListLogs(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pagination = parsePagination(url.searchParams, {
    defaultPageSize: 20,
    maxPageSize: 100,
  });
  const [items, total] = await Promise.all([
    listAdminLogs(env.DB, { page: pagination.page, pageSize: pagination.pageSize }),
    countAdminLogs(env.DB),
  ]);
  return adminJson({ items, total }, 200, env, request);
}

// ---------- 用户详情 ----------

async function handleUserStats(
  request: Request,
  env: Env,
  userId: number,
): Promise<Response> {
  const stats = await getUserStats(env.DB, userId);
  if (!stats) {
    throw new AppError('用户不存在', 404, 'NOT_FOUND');
  }
  return adminJson(stats, 200, env, request);
}

async function handleUserPointsLogs(
  request: Request,
  env: Env,
  userId: number,
): Promise<Response> {
  const url = new URL(request.url);
  const pagination = parsePagination(url.searchParams, {
    defaultPageSize: 20,
    maxPageSize: 100,
  });
  const [items, total] = await Promise.all([
    listPointsLogs(env.DB, {
      userId,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }),
    countPointsLogs(env.DB, userId),
  ]);
  return adminJson({ items, total }, 200, env, request);
}

async function handleUserDownloads(
  request: Request,
  env: Env,
  userId: number,
): Promise<Response> {
  const url = new URL(request.url);
  const pagination = parsePagination(url.searchParams, {
    defaultPageSize: 20,
    maxPageSize: 100,
  });
  const [items, total] = await Promise.all([
    listDownloads(env.DB, {
      userId,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }),
    countDownloadsByUser(env.DB, userId),
  ]);
  return adminJson({ items, total }, 200, env, request);
}

// ---------- 广告 ----------

type AdminAdItem = AdRow & {
  text: string;
  media_file_id: string | null;
  media_unique_id: string | null;
  media_type: string;
  buttons: AdButton[];
};

function toAdminAdItem(ad: AdRow, message: AdMessageRow | null): AdminAdItem {
  return {
    ...ad,
    text: message?.text ?? '',
    media_file_id: message?.media_file_id ?? null,
    media_unique_id: message?.media_unique_id ?? null,
    media_type: message?.media_type ?? '',
    buttons: message ? parseAdButtons(message.buttons) : [],
  };
}

async function handleListAds(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pagination = parsePagination(url.searchParams, {
    defaultPageSize: 20,
    maxPageSize: 100,
  });
  const positionParam = url.searchParams.get('position')?.trim();
  const position: AdPosition | undefined =
    positionParam === 'top' || positionParam === 'bottom' ? positionParam : undefined;
  const enabledParam = url.searchParams.get('enabled');
  const enabled =
    enabledParam === '1' || enabledParam === 'true'
      ? true
      : enabledParam === '0' || enabledParam === 'false'
        ? false
        : undefined;
  const [items, total] = await Promise.all([
    listAds(env.DB, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      position,
      enabled,
    }),
    countAds(env.DB, { position, enabled }),
  ]);
  const messages = await listAdMessagesByAdIds(
    env.DB,
    items.map((item) => item.id),
  );
  const messageByAdId = new Map(messages.map((message) => [message.ad_id, message]));
  return adminJson(
    {
      items: items.map((item) => toAdminAdItem(item, messageByAdId.get(item.id) ?? null)),
      total,
    },
    200,
    env,
    request,
  );
}

async function handleCreateAd(
  request: Request,
  env: Env,
  admin: AdminJwtPayload,
): Promise<Response> {
  const body = await readJsonBody<Record<string, unknown>>(request);
  const position = parseAdPosition(body.position);
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) {
    throw new AppError('广告内容不能为空', 400, 'VALIDATION_ERROR');
  }
  const weight = body.weight === undefined ? 1 : parseNonNegativeInt(body.weight, 'weight');
  const enabled =
    body.enabled === undefined ? true : parseBooleanValue(body.enabled, 'enabled');
  const messagePatch = parseAdMessageFields(body);
  const ad = await createAd(env.DB, { position, content, weight, enabled });
  if (Object.keys(messagePatch).length > 0) {
    await saveAdMessage(env.DB, ad.id, {
      text: messagePatch.text ?? '',
      mediaFileId: messagePatch.mediaFileId ?? null,
      mediaUniqueId: messagePatch.mediaUniqueId ?? null,
      mediaType: messagePatch.mediaType ?? '',
      buttons: messagePatch.buttons ?? [],
    });
  }
  const message = await getAdMessage(env.DB, ad.id);
  await safeWriteAdminLog(
    env.DB,
    admin.userId,
    'ad_create',
    `id=${ad.id} position=${position} enabled=${enabled ? 1 : 0} buttons=${messagePatch.buttons?.length ?? 0}`,
  );
  return adminJson(toAdminAdItem(ad, message), 201, env, request);
}

async function handleUpdateAd(
  request: Request,
  env: Env,
  admin: AdminJwtPayload,
  adId: number,
): Promise<Response> {
  const existing = await getAd(env.DB, adId);
  if (!existing) {
    throw new AppError('广告不存在', 404, 'NOT_FOUND');
  }
  const body = await readJsonBody<Record<string, unknown>>(request);
  const patch: AdUpdateInput = {};
  const messagePatch = parseAdMessageFields(body);
  if ('position' in body) {
    patch.position = parseAdPosition(body.position);
  }
  if ('content' in body) {
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) {
      throw new AppError('广告内容不能为空', 400, 'VALIDATION_ERROR');
    }
    patch.content = content;
  }
  if ('weight' in body) {
    patch.weight = parseNonNegativeInt(body.weight, 'weight');
  }
  if ('enabled' in body) {
    patch.enabled = parseBooleanValue(body.enabled, 'enabled');
  }

  let updated: AdRow = existing;
  if (Object.keys(patch).length > 0) {
    const result = await updateAd(env.DB, adId, patch);
    if (!result) {
      throw new AppError('广告不存在', 404, 'NOT_FOUND');
    }
    updated = result;
  }
  let message = await getAdMessage(env.DB, adId);
  if (Object.keys(messagePatch).length > 0) {
    message = await updateAdMessage(env.DB, adId, messagePatch);
  }
  if (Object.keys(patch).length === 0 && Object.keys(messagePatch).length === 0) {
    return adminJson(toAdminAdItem(existing, message), 200, env, request);
  }
  await safeWriteAdminLog(
    env.DB,
    admin.userId,
    'ad_update',
    `id=${adId} ${JSON.stringify({ ...patch, buttons: messagePatch.buttons?.length ?? undefined })}`,
  );
  return adminJson(toAdminAdItem(updated, message), 200, env, request);
}

async function handleDeleteAd(
  request: Request,
  env: Env,
  admin: AdminJwtPayload,
  adId: number,
): Promise<Response> {
  const ad = await getAd(env.DB, adId);
  if (!ad) {
    throw new AppError('广告不存在', 404, 'NOT_FOUND');
  }
  await deleteAd(env.DB, adId);
  await safeWriteAdminLog(
    env.DB,
    admin.userId,
    'ad_delete',
    `id=${adId} position=${ad.position}`,
  );
  return adminJson({ ok: true }, 200, env, request);
}

// ---------- 字段校验 ----------

function parseFileIds(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  const parts = Array.isArray(value)
    ? value.map((item) => String(item))
    : String(value).split(/[\n,]+/);
  return [
    ...new Set(
      parts
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ];
}

function parseResourceFiles(value: unknown): ResourceFileInput[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const files: ResourceFileInput[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      files.push({ fileId: item.trim(), mediaType: '', sortOrder: files.length });
      continue;
    }
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const fileId = typeof record.fileId === 'string' ? record.fileId.trim() : '';
      if (fileId) {
        files.push({
          fileId,
          fileUniqueId: typeof record.fileUniqueId === 'string' ? record.fileUniqueId : null,
          mediaType: typeof record.mediaType === 'string' ? record.mediaType.trim() : '',
          sortOrder: files.length,
        });
      }
    }
  }
  return files;
}

function parseAdPosition(value: unknown): AdPosition {
  if (value !== 'top' && value !== 'bottom') {
    throw new AppError('position 必须是 top 或 bottom', 400, 'VALIDATION_ERROR');
  }
  return value;
}

function parseNonNegativeInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new AppError(`${label} 必须是非负整数`, 400, 'VALIDATION_ERROR');
  }
  return value;
}

function parseBooleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new AppError(`${label} 必须是布尔值`, 400, 'VALIDATION_ERROR');
  }
  return value;
}

function parseAdButtonsValue(value: unknown): AdButton[] {
  if (!Array.isArray(value)) {
    throw new AppError('buttons 必须是数组', 400, 'VALIDATION_ERROR');
  }
  const buttons: AdButton[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      throw new AppError('按钮必须是 { text, url } 对象', 400, 'VALIDATION_ERROR');
    }
    const record = item as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    if (!text || !url) {
      throw new AppError('按钮的 text 和 url 都不能为空', 400, 'VALIDATION_ERROR');
    }
    buttons.push({ text, url });
  }
  return buttons;
}

function parseAdMessageFields(body: Record<string, unknown>): AdMessageUpdateInput {
  const patch: AdMessageUpdateInput = {};
  if ('text' in body) {
    if (typeof body.text !== 'string') {
      throw new AppError('text 必须是字符串', 400, 'VALIDATION_ERROR');
    }
    patch.text = body.text.trim();
  }
  if ('mediaFileId' in body) {
    const value = body.mediaFileId;
    if (value !== null && typeof value !== 'string') {
      throw new AppError('mediaFileId 必须是字符串或 null', 400, 'VALIDATION_ERROR');
    }
    patch.mediaFileId = typeof value === 'string' ? value.trim() : null;
  }
  if ('mediaUniqueId' in body) {
    const value = body.mediaUniqueId;
    if (value !== null && typeof value !== 'string') {
      throw new AppError('mediaUniqueId 必须是字符串或 null', 400, 'VALIDATION_ERROR');
    }
    patch.mediaUniqueId = typeof value === 'string' ? value.trim() : null;
  }
  if ('mediaType' in body) {
    if (typeof body.mediaType !== 'string') {
      throw new AppError('mediaType 必须是字符串', 400, 'VALIDATION_ERROR');
    }
    patch.mediaType = body.mediaType.trim();
  }
  if ('buttons' in body) {
    patch.buttons = parseAdButtonsValue(body.buttons);
  }
  return patch;
}

function normalizeTitle(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  if (typeof value !== 'string') {
    throw new AppError('title 必须是字符串', 400, 'VALIDATION_ERROR');
  }
  return value.trim();
}

function normalizeTags(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  const parts = Array.isArray(value)
    ? value.map((tag) => String(tag))
    : String(value).split(',');
  return [...new Set(parts.map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean))].join(',');
}

function parsePrice(value: unknown): number {
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new AppError('price 必须是非负整数', 400, 'VALIDATION_ERROR');
  }
  return value;
}
