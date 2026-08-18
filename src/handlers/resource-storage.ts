/**
 * 管理员资源存储流程：持续收集 file_id，支持完成存储、取消存储、添加标题。
 * 会话按管理员 user_id 隔离，使用进程内 Map 保存，仅管理员可进入。
 */

import { InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import { createResource, getUser, type ResourceRow } from '../db/queries';
import { isAdminUserId } from '../utils/auth';
import { generateUniqueShortCode } from '../utils/shortcode';
import type { BotContext } from '../bot';
import {
  extractMediaFromMessage,
  safeWriteAdminLog,
  type BroadcastMediaKind,
} from './broadcast';

export const RESOURCE_STORAGE_START_CALLBACK = 'resource_storage:start';
export const RESOURCE_STORAGE_COMPLETE_CALLBACK = 'resource_storage:complete';
export const RESOURCE_STORAGE_CANCEL_CALLBACK = 'resource_storage:cancel';
export const RESOURCE_STORAGE_TITLE_CALLBACK = 'resource_storage:title';

export const RESOURCE_STORAGE_PROMPT =
  '请发送你要存储的内容，可以多张图片/视频/文件，支持转发';

export function buildCollectingText(count: number): string {
  return `✅ 文件已全部接收\n📁 共添加 ${count} 个文件\n请继续发送文件，或选择操作：`;
}

export interface ResourceStorageFile {
  fileId: string;
  fileUniqueId: string | null;
  mediaType: BroadcastMediaKind;
}

export interface ResourceStorageSession {
  files: ResourceStorageFile[];
  title: string | null;
  awaitingTitle: boolean;
}

export interface ResourceStorageResult {
  resource: ResourceRow;
  fileCount: number;
}

const sessions = new Map<number, ResourceStorageSession>();

export function getResourceStorageSession(
  adminId: number,
): ResourceStorageSession | null {
  return sessions.get(adminId) ?? null;
}

export function startResourceStorageSession(adminId: number): ResourceStorageSession {
  const existing = sessions.get(adminId);
  if (existing) {
    return existing;
  }
  const session: ResourceStorageSession = {
    files: [],
    title: null,
    awaitingTitle: false,
  };
  sessions.set(adminId, session);
  return session;
}

export function collectResourceStorageFile(
  adminId: number,
  file: ResourceStorageFile,
): ResourceStorageSession | null {
  const session = sessions.get(adminId);
  if (!session) {
    return null;
  }
  session.files.push(file);
  return session;
}

export function requestResourceStorageTitle(
  adminId: number,
): ResourceStorageSession | null {
  const session = sessions.get(adminId);
  if (!session) {
    return null;
  }
  session.awaitingTitle = true;
  return session;
}

export function applyResourceStorageTitle(
  adminId: number,
  text: string,
): ResourceStorageSession | null {
  const session = sessions.get(adminId);
  if (!session || !session.awaitingTitle) {
    return null;
  }
  session.title = text.trim();
  session.awaitingTitle = false;
  return session;
}

export function cancelResourceStorageSession(adminId: number): boolean {
  return sessions.delete(adminId);
}

export async function completeResourceStorage(
  db: D1Database,
  adminId: number,
): Promise<ResourceStorageResult | null> {
  const session = sessions.get(adminId);
  if (!session || session.files.length === 0) {
    return null;
  }
  const files = session.files.map((file, index) => ({
    fileId: file.fileId,
    fileUniqueId: file.fileUniqueId,
    mediaType: file.mediaType,
    sortOrder: index,
  }));
  const fileIds = files.map((file) => file.fileId);
  const shortCode = await generateUniqueShortCode(db);
  const title = session.title?.trim() || `资源 ${shortCode}`;
  // creator_id 有外键约束；管理员尚未注册为 Bot 用户时置空。
  const creator = await getUser(db, adminId);
  const resource = await createResource(db, {
    shortCode,
    fileId: fileIds[0],
    fileUniqueId: session.files[0]?.fileUniqueId ?? null,
    fileIds,
    files,
    title,
    creatorId: creator ? adminId : null,
  });
  sessions.delete(adminId);
  return { resource, fileCount: fileIds.length };
}

export function buildResourceStorageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('完成存储', RESOURCE_STORAGE_COMPLETE_CALLBACK)
    .text('取消存储', RESOURCE_STORAGE_CANCEL_CALLBACK)
    .text('添加标题', RESOURCE_STORAGE_TITLE_CALLBACK);
}

async function requireAdmin(ctx: BotContext): Promise<number | null> {
  const from = ctx.from;
  if (!from || !isAdminUserId({ ADMIN_IDS: ctx.env.ADMIN_IDS }, from.id)) {
    await ctx.reply('无权限：仅管理员可使用该功能。');
    return null;
  }
  return from.id;
}

async function answerCallbackSafely(ctx: BotContext): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
  } catch {
    // 回调确认失败不阻塞主流程。
  }
}

export function registerResourceStorageHandlers(bot: Bot<BotContext>): void {
  bot.chatType('private').callbackQuery(RESOURCE_STORAGE_START_CALLBACK, async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      await answerCallbackSafely(ctx);
      return;
    }
    startResourceStorageSession(adminId);
    await ctx.answerCallbackQuery('已进入资源存储');
    await ctx.reply(RESOURCE_STORAGE_PROMPT);
  });

  bot.chatType('private').callbackQuery(RESOURCE_STORAGE_COMPLETE_CALLBACK, async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      await answerCallbackSafely(ctx);
      return;
    }
    const result = await completeResourceStorage(ctx.env.DB, adminId);
    if (!result) {
      await ctx.answerCallbackQuery('当前没有可完成存储的文件');
      await ctx.reply('当前没有可完成存储的文件，请先发送文件。');
      return;
    }
    await safeWriteAdminLog(
      ctx.env.DB,
      adminId,
      'resource_create',
      `id=${result.resource.id} short_code=${result.resource.short_code} title=${result.resource.title} files=${result.fileCount}`,
    );
    await ctx.answerCallbackQuery('资源已保存');
    await ctx.reply(
      `资源存储完成\n短码：${result.resource.short_code}\n序号：${result.resource.sequence}\n共添加 ${result.fileCount} 个文件`,
    );
  });

  bot.chatType('private').callbackQuery(RESOURCE_STORAGE_CANCEL_CALLBACK, async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      await answerCallbackSafely(ctx);
      return;
    }
    const cancelled = cancelResourceStorageSession(adminId);
    await ctx.answerCallbackQuery('已取消存储');
    await ctx.reply(
      cancelled
        ? '已取消存储，本次收集的文件已丢弃。'
        : '当前没有正在进行的资源存储。',
    );
  });

  bot.chatType('private').callbackQuery(RESOURCE_STORAGE_TITLE_CALLBACK, async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      await answerCallbackSafely(ctx);
      return;
    }
    const session = requestResourceStorageTitle(adminId);
    if (!session) {
      await ctx.answerCallbackQuery('请先开始资源存储');
      await ctx.reply('请先开始资源存储。');
      return;
    }
    await ctx.answerCallbackQuery('请输入标题');
    await ctx.reply('请发送标题文本，发送后该文本将作为资源标题。');
  });

  // 收集状态下优先接管媒体，未收集时放行给现有广播/入库处理器。
  bot.chatType('private').on('message:media', async (ctx, next) => {
    const from = ctx.from;
    const storageSession = from ? getResourceStorageSession(from.id) : null;
    if (!storageSession) {
      await next();
      return;
    }
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const media = extractMediaFromMessage(ctx.message);
    if (!media) {
      await ctx.reply('未识别到可收集的媒体，请发送图片、视频、文档、音频等。');
      return;
    }
    const session = collectResourceStorageFile(adminId, {
      fileId: media.fileId,
      fileUniqueId: media.fileUniqueId ?? null,
      mediaType: media.kind,
    });
    if (!session) {
      return;
    }
    await ctx.reply(buildCollectingText(session.files.length), {
      reply_markup: buildResourceStorageKeyboard(),
    });
  });

  // 等待标题时，下一文本消息作为资源标题；其他文本继续走现有流程。
  bot.chatType('private').on('message:text', async (ctx, next) => {
    const from = ctx.from;
    const session = from ? getResourceStorageSession(from.id) : null;
    if (!session || !session.awaitingTitle) {
      await next();
      return;
    }
    const text = ctx.message.text?.trim() ?? '';
    if (!text) {
      await ctx.reply('标题不能为空，请重新发送。');
      return;
    }
    if (!from) {
      await next();
      return;
    }
    applyResourceStorageTitle(from.id, text);
    await ctx.reply(`标题已设置：${text}`);
    await ctx.reply(buildCollectingText(session.files.length), {
      reply_markup: buildResourceStorageKeyboard(),
    });
  });
}
