/**
 * 管理员广告配置：从 /admin 菜单进入后，接收管理员发送/转发的文字+媒体，
 * 校验来源为管理员自己的账号，并把内容保存到 ads + ad_messages（按钮留空待 U7 后台配置）。
 */

import { InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import type { Message } from 'grammy/types';
import {
  createAd,
  saveAdMessage,
  type AdMessageRow,
  type AdRow,
} from '../db/queries';
import { isAdminUserId } from '../utils/auth';
import type { AdPosition } from '../types';
import type { BotContext } from '../bot';
import {
  extractMediaFromMessage,
  getMessageCaption,
  safeWriteAdminLog,
  type BroadcastMediaPayload,
} from './broadcast';

export const AD_CONFIG_START_CALLBACK = 'ad_config:start';
export const AD_CONFIG_POSITION_TOP_CALLBACK = 'ad_config:position:top';
export const AD_CONFIG_POSITION_BOTTOM_CALLBACK = 'ad_config:position:bottom';

export const AD_CONFIG_PROMPT =
  '您正在配置广告内容，请发送或者转发一个待以编辑完成排版好格式的文字的媒体文件给我\n';

interface AdConfigSession {
  position: AdPosition | null;
}

interface AdSender {
  userId: number;
  username: string | null;
}

export interface SaveAdFromForwardInput {
  position: AdPosition;
  text: string;
  media: BroadcastMediaPayload | null;
}

export interface SaveAdFromForwardResult {
  ad: AdRow;
  message: AdMessageRow;
}

const sessions = new Map<number, AdConfigSession>();

export function getAdConfigSession(adminId: number): AdConfigSession | null {
  return sessions.get(adminId) ?? null;
}

export function startAdConfigSession(adminId: number): AdConfigSession {
  const existing = sessions.get(adminId);
  if (existing) {
    return existing;
  }
  const session: AdConfigSession = { position: null };
  sessions.set(adminId, session);
  return session;
}

export function setAdConfigPosition(
  adminId: number,
  position: AdPosition,
): AdConfigSession | null {
  const session = sessions.get(adminId);
  if (!session) {
    return null;
  }
  session.position = position;
  return session;
}

export function clearAdConfigSession(adminId: number): boolean {
  return sessions.delete(adminId);
}

export function positionLabel(position: AdPosition): string {
  return position === 'top' ? '上方' : '下方';
}

/** 保存转发/发送的广告内容：先建广告位记录，再写 ad_messages（按钮留空）。 */
export async function saveAdFromForward(
  db: D1Database,
  adminId: number,
  input: SaveAdFromForwardInput,
): Promise<SaveAdFromForwardResult> {
  const text = input.text ?? '';
  const ad = await createAd(db, {
    position: input.position,
    content: text.trim() || '（媒体广告）',
    weight: 1,
    enabled: true,
  });
  const message = await saveAdMessage(db, ad.id, {
    text,
    mediaFileId: input.media?.fileId ?? null,
    mediaUniqueId: input.media?.fileUniqueId ?? null,
    mediaType: input.media?.kind ?? '',
    buttons: [],
  });
  await safeWriteAdminLog(
    db,
    adminId,
    'ad_config_save',
    `id=${ad.id} position=${input.position} media=${input.media ? 1 : 0}`,
  );
  return { ad, message };
}

function isForwardedMessage(msg: Message): boolean {
  return (
    msg.forward_origin !== undefined ||
    (msg as { is_automatic_forward?: true }).is_automatic_forward === true
  );
}

function resolveAdminSender(ctx: BotContext, msg: Message): AdSender | null {
  const origin = (
    msg as {
      forward_origin?: {
        sender_user?: { id: number; username?: string | null };
      };
    }
  ).forward_origin;
  if (origin?.sender_user) {
    const sender = origin.sender_user;
    if (!isAdminUserId({ ADMIN_IDS: ctx.env.ADMIN_IDS }, sender.id)) {
      return null;
    }
    return { userId: sender.id, username: sender.username ?? null };
  }
  if (!isForwardedMessage(msg) && ctx.from) {
    return { userId: ctx.from.id, username: ctx.from.username ?? null };
  }
  return null;
}

function buildPositionKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('上方广告位', AD_CONFIG_POSITION_TOP_CALLBACK)
    .row()
    .text('下方广告位', AD_CONFIG_POSITION_BOTTOM_CALLBACK);
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

function formatSender(sender: AdSender): string {
  return `Username ${sender.username ? `@${sender.username}` : '-'} / user_id ${sender.userId}`;
}

async function selectPosition(ctx: BotContext, position: AdPosition): Promise<void> {
  const adminId = await requireAdmin(ctx);
  if (adminId === null) {
    await answerCallbackSafely(ctx);
    return;
  }
  const session = setAdConfigPosition(adminId, position);
  if (!session) {
    await ctx.answerCallbackQuery('请先进入广告配置');
    return;
  }
  await ctx.answerCallbackQuery(`已选择${positionLabel(position)}广告位`);
  await ctx.reply(`已选择${positionLabel(position)}广告位，请发送或转发广告内容。`);
}

export function registerAdConfigHandlers(bot: Bot<BotContext>): void {
  bot.chatType('private').callbackQuery(AD_CONFIG_START_CALLBACK, async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      await answerCallbackSafely(ctx);
      return;
    }
    startAdConfigSession(adminId);
    await ctx.answerCallbackQuery('已进入广告配置');
    await ctx.reply(AD_CONFIG_PROMPT, { reply_markup: buildPositionKeyboard() });
  });

  bot.chatType('private').callbackQuery(AD_CONFIG_POSITION_TOP_CALLBACK, async (ctx) => {
    await selectPosition(ctx, 'top');
  });

  bot.chatType('private').callbackQuery(AD_CONFIG_POSITION_BOTTOM_CALLBACK, async (ctx) => {
    await selectPosition(ctx, 'bottom');
  });

  // 广告配置会话中优先接管媒体；无会话时放行给广播/自动入库等下游处理器。
  bot.chatType('private').on('message:media', async (ctx, next) => {
    const from = ctx.from;
    const session = from ? getAdConfigSession(from.id) : null;
    if (!session) {
      await next();
      return;
    }
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    if (!session.position) {
      await ctx.reply('请先选择广告位（上方/下方），再发送或转发广告内容。');
      return;
    }
    const media = extractMediaFromMessage(ctx.message);
    if (!media) {
      await ctx.reply('未识别到广告媒体，请发送或转发图片、视频、文档、音频等。');
      return;
    }
    const sender = resolveAdminSender(ctx, ctx.message);
    if (!sender) {
      await ctx.reply('广告内容必须来自管理员自己的账号，请从你的账号发送或转发。');
      return;
    }
    const text = getMessageCaption(ctx.message) ?? '';
    const saved = await saveAdFromForward(ctx.env.DB, adminId, {
      position: session.position,
      text,
      media,
    });
    clearAdConfigSession(adminId);
    await ctx.reply(
      [
        '广告已保存',
        `来源：${formatSender(sender)}`,
        `广告位：${positionLabel(saved.ad.position)}`,
        `文字：${text.trim() || '-'}`,
        `媒体：${media.kind}（${media.fileId}）`,
      ].join('\n'),
    );
  });

  // 广告配置会话中仅接管管理员转发的纯文本（无媒体广告）；其他文本继续走现有流程。
  bot.chatType('private').on('message:text', async (ctx, next) => {
    const from = ctx.from;
    const session = from ? getAdConfigSession(from.id) : null;
    if (!session) {
      await next();
      return;
    }
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    if (!session.position) {
      await ctx.reply('请先选择广告位（上方/下方），再发送或转发广告内容。');
      return;
    }
    if (!isForwardedMessage(ctx.message)) {
      await next();
      return;
    }
    const text = ctx.message.text?.trim() ?? '';
    if (!text) {
      await next();
      return;
    }
    const sender = resolveAdminSender(ctx, ctx.message);
    if (!sender) {
      await ctx.reply('广告内容必须来自管理员自己的账号，请从你的账号发送或转发。');
      return;
    }
    const saved = await saveAdFromForward(ctx.env.DB, adminId, {
      position: session.position,
      text,
      media: null,
    });
    clearAdConfigSession(adminId);
    await ctx.reply(
      [
        '广告已保存',
        `来源：${formatSender(sender)}`,
        `广告位：${positionLabel(saved.ad.position)}`,
        `文字：${text}`,
      ].join('\n'),
    );
  });
}
