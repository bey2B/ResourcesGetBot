/**
 * 广播处理器与执行引擎：立即广播、定时广播（一次性/每天/每周/每月）、进度报告。
 * executeBroadcast 独立可调用，供 src/cron.ts 与任务 6 的 Cron Trigger 复用。
 */

import type { Api, Bot } from 'grammy';
import type { Message } from 'grammy/types';
import {
  cancelBroadcast,
  claimBroadcastForSending,
  createBroadcast,
  finishBroadcast,
  getBroadcast,
  listBroadcasts,
  listUserIdsForBroadcast,
  rescheduleBroadcast,
  updateBroadcastProgress,
  updateBroadcastStatus,
  writeAdminLog,
  type BroadcastRow,
} from '../db/queries';
import { isAdminUserId } from '../utils/auth';
import {
  AppError,
  errorMessage,
  formatLocalDateTime,
  utcNowIso,
} from '../utils/helpers';
import type { BroadcastStatus, BroadcastType } from '../types';
import type { BotContext } from '../bot';

export type BroadcastMediaKind =
  | 'document'
  | 'photo'
  | 'video'
  | 'animation'
  | 'audio'
  | 'voice'
  | 'video_note'
  | 'sticker';

export interface BroadcastMediaPayload {
  kind: BroadcastMediaKind;
  fileId: string;
  fileUniqueId?: string | null;
  caption?: string;
}

interface BroadcastContentEnvelope {
  v: 1;
  kind: 'text' | 'media';
  text?: string;
  media?: BroadcastMediaPayload;
}

export type ParsedBroadcastContent =
  | { kind: 'text'; text: string }
  | { kind: 'media'; media: BroadcastMediaPayload };

export interface BroadcastDeliverer {
  sendText(chatId: number, text: string): Promise<void>;
  sendMedia(chatId: number, media: BroadcastMediaPayload): Promise<void>;
}

export interface ParsedSchedule {
  scheduledAt: string;
  content: string;
}

export type ScheduleParseResult =
  | { ok: true; value: ParsedSchedule }
  | { ok: false; message: string };

export type MediaBroadcastCommand =
  | { schedule: false; caption: string }
  | { schedule: true; type: BroadcastType; scheduledAt: string; caption: string };

export interface BroadcastExecutionOptions {
  now?: Date;
  /** 相邻用户之间的发送间隔，默认 35ms，用于规避 Telegram 限速。 */
  delayMs?: number;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export interface BroadcastProgressReport {
  broadcastId: number;
  status: BroadcastStatus;
  total: number;
  success: number;
  fail: number;
  skip: number;
  message: string;
  errors: string[];
  nextScheduledAt: string | null;
}

const BROADCAST_CAPTION_RE = /^\s*\/(bc|broadcast|bc_once|bc_daily|bc_weekly|bc_monthly)\b/i;
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1000, 5000];
const DEFAULT_BATCH_DELAY_MS = 35;

const BROADCAST_TYPE_LABELS: Record<BroadcastType, string> = {
  now: '立即',
  once: '一次性',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
};

const BROADCAST_STATUS_LABELS: Record<BroadcastStatus, string> = {
  pending: '待发送',
  scheduled: '已定时',
  sending: '发送中',
  sent: '已完成',
  partial: '部分成功',
  failed: '失败',
  cancelled: '已取消',
};

const BROADCAST_HELP = `广播命令：
/bc <内容> - 立即向全部用户广播文本
/bc_once <YYYY-MM-DD HH:MM> <内容> - 一次性定时广播
/bc_daily <HH:MM> <内容> - 每天定时广播
/bc_weekly <HH:MM> <内容> - 每周定时广播
/bc_monthly <日(1-28)> <HH:MM> <内容> - 每月定时广播
/bc_list [页码] - 查看广播记录
/bc_cancel <ID> - 取消定时广播

转发媒体给本 Bot：说明以 /bc 开头即广播（如 /bc 今日推荐、/bc_daily 10:00 早报），否则自动入库。
转发文本给本 Bot：立即广播该文本。`;

export function getMessageCaption(msg: Message): string | undefined {
  return (msg as { caption?: string }).caption;
}

/** 统一提取转发/直发消息中的媒体文件，photo 取分辨率最高的一张。 */
export function extractMediaFromMessage(msg: Message): BroadcastMediaPayload | null {
  interface SizedFile {
    file_id: string;
    file_unique_id?: string;
  }
  const photo = (msg as { photo?: SizedFile[] }).photo;
  if (photo && photo.length > 0) {
    const size = photo[photo.length - 1];
    if (size) {
      return {
        kind: 'photo',
        fileId: size.file_id,
        fileUniqueId: size.file_unique_id ?? null,
      };
    }
  }
  const candidates: Array<[BroadcastMediaKind, SizedFile | undefined]> = [
    ['document', (msg as { document?: SizedFile }).document],
    ['video', (msg as { video?: SizedFile }).video],
    ['audio', (msg as { audio?: SizedFile }).audio],
    ['voice', (msg as { voice?: SizedFile }).voice],
    ['animation', (msg as { animation?: SizedFile }).animation],
    ['video_note', (msg as { video_note?: SizedFile }).video_note],
    ['sticker', (msg as { sticker?: SizedFile }).sticker],
  ];
  for (const [kind, file] of candidates) {
    if (file) {
      return {
        kind,
        fileId: file.file_id,
        fileUniqueId: file.file_unique_id ?? null,
      };
    }
  }
  return null;
}

export function isBroadcastCaptionCommand(caption: string | undefined): boolean {
  return BROADCAST_CAPTION_RE.test(caption ?? '');
}

export function serializeBroadcastText(text: string): string {
  return JSON.stringify({ v: 1, kind: 'text', text });
}

export function serializeBroadcastMedia(media: BroadcastMediaPayload): string {
  return JSON.stringify({ v: 1, kind: 'media', media });
}

export function parseBroadcastContent(content: string): ParsedBroadcastContent {
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<BroadcastContentEnvelope>;
      if (parsed?.kind === 'media' && parsed.media?.fileId) {
        return { kind: 'media', media: parsed.media };
      }
      if (parsed?.kind === 'text' && typeof parsed.text === 'string') {
        return { kind: 'text', text: parsed.text };
      }
    } catch {
      // 非 JSON 内容按纯文本处理。
    }
  }
  return { kind: 'text', text: content };
}

export function previewBroadcastContent(content: string, maxLength = 40): string {
  const parsed = parseBroadcastContent(content);
  const text =
    parsed.kind === 'media' ? parsed.media.caption || '[媒体广播]' : parsed.text;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function createTelegramDeliverer(api: Api): BroadcastDeliverer {
  return {
    async sendText(chatId, text) {
      await api.sendMessage(chatId, text);
    },
    async sendMedia(chatId, media) {
      const captionOptions = media.caption ? { caption: media.caption } : undefined;
      const attempts: Array<() => Promise<unknown>> = [
        () => api.sendDocument(chatId, media.fileId, captionOptions),
        () => api.sendPhoto(chatId, media.fileId, captionOptions),
        () => api.sendVideo(chatId, media.fileId, captionOptions),
        () => api.sendAnimation(chatId, media.fileId, captionOptions),
        () => api.sendAudio(chatId, media.fileId, captionOptions),
        () => api.sendVoice(chatId, media.fileId, captionOptions),
        () => api.sendVideoNote(chatId, media.fileId),
        () => api.sendSticker(chatId, media.fileId),
      ];
      let lastError: unknown = null;
      for (const attempt of attempts) {
        try {
          await attempt();
          return;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError ?? new Error('媒体发送失败');
    },
  };
}

function isValidTime(hours: number, minutes: number): boolean {
  return (
    Number.isInteger(hours) &&
    Number.isInteger(minutes) &&
    hours >= 0 &&
    hours <= 23 &&
    minutes >= 0 &&
    minutes <= 59
  );
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 计算下一个 HH:MM（UTC）：今天该时刻若已过则顺延到明天。 */
export function nextOccurrenceOfTime(hours: number, minutes: number, now = new Date()): Date {
  if (!isValidTime(hours, minutes)) {
    throw new AppError('时间格式无效', 400, 'VALIDATION_ERROR');
  }
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes, 0, 0),
  );
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

/** 计算下一个每月定时时刻（UTC），仅接受 1-28 日以避免月末进位歧义。 */
export function nextMonthlyOccurrence(
  day: number,
  hours: number,
  minutes: number,
  now = new Date(),
): Date {
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw new AppError('每月定时日必须是 1 到 28 之间的整数', 400, 'VALIDATION_ERROR');
  }
  if (!isValidTime(hours, minutes)) {
    throw new AppError('时间格式无效', 400, 'VALIDATION_ERROR');
  }
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hours, minutes, 0, 0),
  );
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  }
  return candidate;
}

/** 定时广播执行完成后计算下一次执行时间。 */
export function computeNextOccurrence(
  type: BroadcastType,
  anchorIso: string,
  now = new Date(),
): string {
  if (type === 'now' || type === 'once') {
    return anchorIso;
  }
  const anchor = new Date(anchorIso);
  if (Number.isNaN(anchor.getTime())) {
    throw new AppError('定时广播基准时间无效', 400, 'VALIDATION_ERROR');
  }
  const next = new Date(anchor.getTime());
  if (type === 'daily') {
    next.setUTCDate(anchor.getUTCDate() + 1);
  } else if (type === 'weekly') {
    next.setUTCDate(anchor.getUTCDate() + 7);
  } else if (type === 'monthly') {
    const year = anchor.getUTCFullYear();
    const nextMonth = anchor.getUTCMonth() + 1;
    const day = Math.min(anchor.getUTCDate(), daysInMonth(year, nextMonth + 1));
    next.setUTCFullYear(year, nextMonth, day);
  }
  return next.toISOString();
}

/** 解析定时广播命令参数，返回首次发送时间与剩余内容。 */
export function parseScheduleArgs(
  type: BroadcastType,
  args: string,
  now = new Date(),
): ScheduleParseResult {
  const trimmed = args.trim();
  if (type === 'once') {
    const match = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?:\s+([\s\S]*))?$/.exec(trimmed);
    if (!match) {
      return { ok: false, message: '一次性定时广播格式：/bc_once YYYY-MM-DD HH:MM 内容' };
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hours = Number(match[4]);
    const minutes = Number(match[5]);
    if (!isValidDateParts(year, month, day) || !isValidTime(hours, minutes)) {
      return { ok: false, message: '日期或时间无效' };
    }
    const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
    if (date.getTime() <= now.getTime()) {
      return { ok: false, message: '定时时间必须晚于当前时间' };
    }
    return {
      ok: true,
      value: { scheduledAt: date.toISOString(), content: (match[6] ?? '').trim() },
    };
  }
  if (type === 'daily' || type === 'weekly') {
    const match = /^(\d{2}):(\d{2})(?:\s+([\s\S]*))?$/.exec(trimmed);
    if (!match) {
      return {
        ok: false,
        message:
          type === 'daily'
            ? '每天定时广播格式：/bc_daily HH:MM 内容'
            : '每周定时广播格式：/bc_weekly HH:MM 内容',
      };
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!isValidTime(hours, minutes)) {
      return { ok: false, message: '时间无效，HH 为 00-23，MM 为 00-59' };
    }
    return {
      ok: true,
      value: {
        scheduledAt: nextOccurrenceOfTime(hours, minutes, now).toISOString(),
        content: (match[3] ?? '').trim(),
      },
    };
  }
  if (type === 'monthly') {
    const match = /^(\d{1,2})\s+(\d{2}):(\d{2})(?:\s+([\s\S]*))?$/.exec(trimmed);
    if (!match) {
      return { ok: false, message: '每月定时广播格式：/bc_monthly 日(1-28) HH:MM 内容' };
    }
    const day = Number(match[1]);
    const hours = Number(match[2]);
    const minutes = Number(match[3]);
    if (day < 1 || day > 28) {
      return { ok: false, message: '每月定时日必须是 1 到 28' };
    }
    if (!isValidTime(hours, minutes)) {
      return { ok: false, message: '时间无效，HH 为 00-23，MM 为 00-59' };
    }
    return {
      ok: true,
      value: {
        scheduledAt: nextMonthlyOccurrence(day, hours, minutes, now).toISOString(),
        content: (match[4] ?? '').trim(),
      },
    };
  }
  return { ok: false, message: '不支持的广播类型' };
}

/** 解析媒体说明中的广播命令：/bc 立即广播，/bc_xxx 定时广播。 */
export function parseBroadcastCaption(caption: string | undefined): MediaBroadcastCommand | null {
  const trimmed = (caption ?? '').trim();
  const match = /^\/(bc|broadcast|bc_once|bc_daily|bc_weekly|bc_monthly)(?:\s+([\s\S]*))?$/i.exec(
    trimmed,
  );
  if (!match) {
    return null;
  }
  const command = match[1].toLowerCase();
  const args = (match[2] ?? '').trim();
  if (command === 'bc' || command === 'broadcast') {
    return { schedule: false, caption: args };
  }
  const typeMap: Record<string, BroadcastType> = {
    bc_once: 'once',
    bc_daily: 'daily',
    bc_weekly: 'weekly',
    bc_monthly: 'monthly',
  };
  const type = typeMap[command];
  const parsed = parseScheduleArgs(type, args);
  if (!parsed.ok) {
    throw new AppError(`广播说明格式错误：${parsed.message}`, 400, 'VALIDATION_ERROR');
  }
  return {
    schedule: true,
    type,
    scheduledAt: parsed.value.scheduledAt,
    caption: parsed.value.content,
  };
}

function isPermanentSkipError(err: unknown): boolean {
  const error = err as { description?: string; message?: string };
  const description = `${error.description ?? ''} ${error.message ?? ''}`;
  return (
    /chat not found/i.test(description) ||
    /bot was blocked by the user/i.test(description) ||
    /user is deactivated/i.test(description) ||
    /bot was kicked/i.test(description) ||
    /chat was upgraded/i.test(description)
  );
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function sendBroadcastOnce(
  userId: number,
  content: ParsedBroadcastContent,
  deliverer: BroadcastDeliverer,
): Promise<void> {
  if (content.kind === 'media') {
    await deliverer.sendMedia(userId, content.media);
  } else {
    await deliverer.sendText(userId, content.text);
  }
}

async function sendWithRetry(
  userId: number,
  content: ParsedBroadcastContent,
  deliverer: BroadcastDeliverer,
  options: BroadcastExecutionOptions,
): Promise<{ result: 'success' | 'skip' | 'fail'; error?: string }> {
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      await sendBroadcastOnce(userId, content, deliverer);
      return { result: 'success' };
    } catch (err) {
      lastError = err;
      if (isPermanentSkipError(err)) {
        return { result: 'skip', error: errorMessage(err) };
      }
      if (attempt < delays.length) {
        const retryAfter = (
          err as { parameters?: { retry_after?: number } }
        ).parameters?.retry_after;
        const delay =
          retryAfter !== undefined
            ? Math.min(60_000, Math.max(250, retryAfter * 1000))
            : (delays[attempt] ?? 1000);
        await sleep(delay);
      }
    }
  }
  return { result: 'fail', error: errorMessage(lastError) };
}

export async function safeWriteAdminLog(
  db: D1Database,
  adminId: number,
  action: string,
  detail: string,
): Promise<void> {
  try {
    await writeAdminLog(db, {
      adminId,
      action,
      detail: String(detail).slice(0, 1000),
    });
  } catch (err) {
    console.error('[admin-log]', action, errorMessage(err));
  }
}

/**
 * 串行执行一条广播并汇总进度。
 * 返回的报告同时包含最终状态与下一次定时执行时间，供 handler/cron 直接使用。
 */
export async function executeBroadcast(
  db: D1Database,
  broadcast: BroadcastRow,
  deliverer: BroadcastDeliverer,
  options: BroadcastExecutionOptions = {},
): Promise<BroadcastProgressReport> {
  const now = options.now ?? new Date();
  const claimed = await claimBroadcastForSending(db, broadcast.id);
  if (!claimed) {
    return {
      broadcastId: broadcast.id,
      status: broadcast.status,
      total: broadcast.total_count,
      success: broadcast.success_count,
      fail: broadcast.fail_count,
      skip: broadcast.skip_count,
      message: '广播未在可执行状态，已跳过。',
      errors: [],
      nextScheduledAt: broadcast.scheduled_at,
    };
  }

  const content = parseBroadcastContent(broadcast.content);
  const userIds = await listUserIdsForBroadcast(db);
  const counts = { success: 0, fail: 0, skip: 0 };
  const errors: string[] = [];
  const sleep = options.sleep ?? defaultSleep;
  const delayMs = options.delayMs ?? DEFAULT_BATCH_DELAY_MS;

  for (const userId of userIds) {
    const outcome = await sendWithRetry(userId, content, deliverer, options);
    if (outcome.result === 'success') {
      counts.success += 1;
    } else if (outcome.result === 'skip') {
      counts.skip += 1;
      if (outcome.error) {
        errors.push(`用户 ${userId} 跳过：${outcome.error}`);
      }
    } else {
      counts.fail += 1;
      if (outcome.error) {
        errors.push(`用户 ${userId} 失败：${outcome.error}`);
      }
    }
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  const total = userIds.length;
  await updateBroadcastProgress(db, broadcast.id, {
    totalCount: total,
    successCount: counts.success,
    failCount: counts.fail,
    skipCount: counts.skip,
  });

  let status: BroadcastStatus;
  let nextScheduledAt: string | null = null;
  const isRecurring =
    broadcast.type === 'daily' || broadcast.type === 'weekly' || broadcast.type === 'monthly';
  if (isRecurring) {
    nextScheduledAt = computeNextOccurrence(
      broadcast.type,
      broadcast.scheduled_at ?? now.toISOString(),
      now,
    );
    await rescheduleBroadcast(db, broadcast.id, nextScheduledAt);
    await updateBroadcastStatus(db, broadcast.id, 'scheduled');
    status = 'scheduled';
  } else {
    status =
      counts.success > 0 && counts.fail > 0
        ? 'partial'
        : counts.success > 0
          ? 'sent'
          : 'failed';
    await finishBroadcast(db, broadcast.id, status);
  }

  await safeWriteAdminLog(
    db,
    broadcast.created_by,
    'broadcast_finished',
    `id=${broadcast.id} type=${broadcast.type} total=${total} success=${counts.success} fail=${counts.fail} skip=${counts.skip} status=${status}`,
  );

  return {
    broadcastId: broadcast.id,
    status,
    total,
    success: counts.success,
    fail: counts.fail,
    skip: counts.skip,
    message: `广播 #${broadcast.id} 执行完成：成功 ${counts.success}，失败 ${counts.fail}，跳过 ${counts.skip}。`,
    errors: errors.slice(0, 5),
    nextScheduledAt,
  };
}

function buildBroadcastReport(report: BroadcastProgressReport): string {
  const lines = [
    `广播 #${report.broadcastId} 执行完成`,
    `总计：${report.total}`,
    `成功：${report.success}`,
    `失败：${report.fail}`,
    `跳过：${report.skip}`,
    `状态：${BROADCAST_STATUS_LABELS[report.status] ?? report.status}`,
  ];
  if (report.nextScheduledAt) {
    lines.push(`下次发送：${formatLocalDateTime(report.nextScheduledAt)}`);
  }
  if (report.errors.length > 0) {
    lines.push(`失败/跳过示例：\n${report.errors.slice(0, 3).join('\n')}`);
  }
  return lines.join('\n');
}

async function requireAdmin(ctx: BotContext): Promise<number | null> {
  const from = ctx.from;
  if (!from || !isAdminUserId({ ADMIN_IDS: ctx.env.ADMIN_IDS }, from.id)) {
    await ctx.reply('无权限：仅管理员可使用该功能。');
    return null;
  }
  return from.id;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number((value ?? '').trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isForwardedMessage(msg: Message): boolean {
  return (
    msg.forward_origin !== undefined ||
    (msg as { is_automatic_forward?: true }).is_automatic_forward === true
  );
}

function runBroadcastAsync(
  ctx: BotContext,
  adminId: number,
  row: BroadcastRow,
  deliverer: BroadcastDeliverer,
): void {
  const run = async (): Promise<void> => {
    try {
      const report = await executeBroadcast(ctx.env.DB, row, deliverer);
      await ctx.api.sendMessage(adminId, buildBroadcastReport(report));
    } catch (err) {
      await ctx.api.sendMessage(adminId, `广播 #${row.id} 执行失败：${errorMessage(err)}`);
    }
  };
  if (ctx.env.waitUntil) {
    ctx.env.waitUntil(run());
    return;
  }
  setTimeout(() => {
    void run().catch(() => undefined);
  }, 0);
}

async function startImmediateTextBroadcast(
  ctx: BotContext,
  adminId: number,
  text: string,
): Promise<void> {
  const row = await createBroadcast(ctx.env.DB, {
    content: serializeBroadcastText(text),
    type: 'now',
    scheduledAt: utcNowIso(),
    createdBy: adminId,
  });
  await safeWriteAdminLog(
    ctx.env.DB,
    adminId,
    'broadcast_create',
    `id=${row.id} type=now content=${text.slice(0, 200)}`,
  );
  await ctx.reply(`已创建立即广播 #${row.id}，开始逐批发送，完成后将汇报进度。`);
  runBroadcastAsync(ctx, adminId, row, createTelegramDeliverer(ctx.api));
}

async function scheduleTextBroadcast(
  ctx: BotContext,
  adminId: number,
  type: BroadcastType,
  args: string,
): Promise<void> {
  const parsed = parseScheduleArgs(type, args);
  if (!parsed.ok) {
    await ctx.reply(parsed.message);
    return;
  }
  if (!parsed.value.content) {
    await ctx.reply('广播内容不能为空。');
    return;
  }
  const row = await createBroadcast(ctx.env.DB, {
    content: serializeBroadcastText(parsed.value.content),
    type,
    scheduledAt: parsed.value.scheduledAt,
    createdBy: adminId,
  });
  await updateBroadcastStatus(ctx.env.DB, row.id, 'scheduled');
  await safeWriteAdminLog(
    ctx.env.DB,
    adminId,
    'broadcast_schedule',
    `id=${row.id} type=${type} at=${parsed.value.scheduledAt}`,
  );
  await ctx.reply(
    `已安排定时广播 #${row.id}（${BROADCAST_TYPE_LABELS[type]}）\n首次发送：${formatLocalDateTime(parsed.value.scheduledAt)}`,
  );
}

export function registerBroadcastHandlers(bot: Bot<BotContext>): void {
  bot.chatType('private').command('bc_help', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    await ctx.reply(BROADCAST_HELP);
  });

  bot.chatType('private').command('bc', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const args = (ctx.match ?? '').trim();
    if (!args) {
      await ctx.reply(BROADCAST_HELP);
      return;
    }
    await startImmediateTextBroadcast(ctx, adminId, args);
  });

  bot.chatType('private').command('broadcast', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const args = (ctx.match ?? '').trim();
    if (!args) {
      await ctx.reply(BROADCAST_HELP);
      return;
    }
    await startImmediateTextBroadcast(ctx, adminId, args);
  });

  bot.chatType('private').command('bc_once', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    await scheduleTextBroadcast(ctx, adminId, 'once', ctx.match ?? '');
  });

  bot.chatType('private').command('bc_daily', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    await scheduleTextBroadcast(ctx, adminId, 'daily', ctx.match ?? '');
  });

  bot.chatType('private').command('bc_weekly', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    await scheduleTextBroadcast(ctx, adminId, 'weekly', ctx.match ?? '');
  });

  bot.chatType('private').command('bc_monthly', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    await scheduleTextBroadcast(ctx, adminId, 'monthly', ctx.match ?? '');
  });

  bot.chatType('private').command('bc_list', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const page = parsePositiveInt(ctx.match, 1);
    const rows = await listBroadcasts(ctx.env.DB, { page, pageSize: 15 });
    if (rows.length === 0) {
      await ctx.reply('暂无广播记录。');
      return;
    }
    const lines = rows.map((row) => {
      return (
        `#${row.id} ${BROADCAST_TYPE_LABELS[row.type] ?? row.type}｜${BROADCAST_STATUS_LABELS[row.status] ?? row.status}\n` +
        `时间：${formatLocalDateTime(row.scheduled_at ?? row.created_at)}\n` +
        `内容：${previewBroadcastContent(row.content)}\n` +
        `进度：成功 ${row.success_count} / 失败 ${row.fail_count} / 跳过 ${row.skip_count} / 共 ${row.total_count}`
      );
    });
    await ctx.reply(`广播记录（第 ${page} 页）：\n${lines.join('\n\n')}`);
  });

  bot.chatType('private').command('bc_cancel', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const raw = (ctx.match ?? '').trim();
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      await ctx.reply('用法：/bc_cancel <ID>');
      return;
    }
    const row = await getBroadcast(ctx.env.DB, id);
    if (!row) {
      await ctx.reply('广播不存在。');
      return;
    }
    if (!['pending', 'scheduled', 'sending'].includes(row.status)) {
      await ctx.reply(`该广播当前状态为 ${row.status}，无法取消。`);
      return;
    }
    await cancelBroadcast(ctx.env.DB, id);
    await safeWriteAdminLog(ctx.env.DB, adminId, 'broadcast_cancel', `id=${id} type=${row.type}`);
    await ctx.reply(`广播 #${id} 已取消。`);
  });

  // 转发媒体：说明以 /bc 开头时执行广播；否则交给后面的管理员入库处理器。
  bot.chatType('private').on('message:media', async (ctx, next) => {
    let command: MediaBroadcastCommand | null = null;
    try {
      command = parseBroadcastCaption(getMessageCaption(ctx.message));
    } catch (err) {
      const adminId = await requireAdmin(ctx);
      if (adminId === null) {
        return;
      }
      await ctx.reply(errorMessage(err));
      return;
    }
    if (!command) {
      await next();
      return;
    }
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const media = extractMediaFromMessage(ctx.message);
    if (!media) {
      await ctx.reply('无法识别该媒体文件，请转发图片、视频、文档、音频等。');
      return;
    }
    const payload: BroadcastMediaPayload = {
      ...media,
      caption: command.caption,
    };
    if (command.schedule) {
      const row = await createBroadcast(ctx.env.DB, {
        content: serializeBroadcastMedia(payload),
        type: command.type,
        scheduledAt: command.scheduledAt,
        createdBy: adminId,
      });
      await updateBroadcastStatus(ctx.env.DB, row.id, 'scheduled');
      await safeWriteAdminLog(
        ctx.env.DB,
        adminId,
        'broadcast_schedule',
        `id=${row.id} type=${command.type} media=1 at=${command.scheduledAt}`,
      );
      await ctx.reply(
        `已安排媒体定时广播 #${row.id}（${BROADCAST_TYPE_LABELS[command.type]}）\n首次发送：${formatLocalDateTime(command.scheduledAt)}`,
      );
      return;
    }
    const row = await createBroadcast(ctx.env.DB, {
      content: serializeBroadcastMedia(payload),
      type: 'now',
      scheduledAt: utcNowIso(),
      createdBy: adminId,
    });
    await safeWriteAdminLog(
      ctx.env.DB,
      adminId,
      'broadcast_create',
      `id=${row.id} type=now media=1 caption=${(command.caption ?? '').slice(0, 200)}`,
    );
    await ctx.reply(`已创建媒体广播 #${row.id}，开始逐批发送，完成后将汇报进度。`);
    runBroadcastAsync(ctx, adminId, row, createTelegramDeliverer(ctx.api));
  });

  // 转发文本：管理员转发消息给 Bot 时直接作为立即广播内容。
  bot.chatType('private').on('message:text', async (ctx, next) => {
    const msg = ctx.message;
    if (!isForwardedMessage(msg)) {
      await next();
      return;
    }
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const text = msg.text?.trim();
    if (!text) {
      await next();
      return;
    }
    await startImmediateTextBroadcast(ctx, adminId, text);
  });
}
