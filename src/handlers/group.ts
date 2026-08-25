/**
 * 群组处理器：群内发送纯短码消息时回复引导消息（不直接发送资源），
 * 用户点击按钮跳转到私聊 Bot 获取资源。支持配置自动删除。
 */

import { InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import { getResourceByShortCode, getSettings } from '../db/queries';
import { parseBoolean } from '../utils/helpers';
import { isValidShortCode } from '../utils/shortcode';
import type { BotContext } from '../bot';

export const GROUP_REPLY_ENABLED_KEY = 'group_reply_enabled';
export const GROUP_AUTO_DELETE_SECONDS_KEY = 'group_auto_delete_seconds';
export const DEFAULT_GROUP_AUTO_DELETE_SECONDS = 0;

/** 仅接受整条消息就是 8 位短码的文本，其他内容一律不回复。 */
export function extractPureShortCode(text: string): string | null {
  const trimmed = text.trim().toLowerCase();
  return isValidShortCode(trimmed) ? trimmed : null;
}

function parseAutoDeleteSeconds(raw: string | null | undefined): number {
  const parsed = Number(raw ?? '');
  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_GROUP_AUTO_DELETE_SECONDS;
}

async function safeDelete(ctx: BotContext, chatId: number, messageId: number): Promise<void> {
  try {
    await ctx.api.deleteMessage(chatId, messageId);
  } catch {
    // 消息可能已被用户或 Telegram 删除，静默跳过。
  }
}

function scheduleDeletion(
  ctx: BotContext,
  chatId: number,
  userMessageId: number,
  botMessageIds: readonly number[],
  seconds: number,
): void {
  const run = async (): Promise<void> => {
    await safeDelete(ctx, chatId, userMessageId);
    for (const messageId of botMessageIds) {
      await safeDelete(ctx, chatId, messageId);
    }
  };
  if (ctx.env.waitUntil) {
    ctx.env.waitUntil(run());
    return;
  }
  setTimeout(() => {
    void run().catch(() => undefined);
  }, seconds * 1000);
}

export function registerGroupHandlers(bot: Bot<BotContext>): void {
  bot.chatType(['group', 'supergroup']).on('message:text', async (ctx, next) => {
    const text = ctx.message.text;
    if (!text) {
      await next();
      return;
    }
    const shortCode = extractPureShortCode(text);
    if (!shortCode) {
      await next();
      return;
    }
    const db = ctx.env.DB;
    const settings = await getSettings(db, [
      GROUP_REPLY_ENABLED_KEY,
      GROUP_AUTO_DELETE_SECONDS_KEY,
    ]);
    if (!parseBoolean(settings[GROUP_REPLY_ENABLED_KEY], true)) {
      await next();
      return;
    }
    // 群组中只发引导消息，不直接投递资源
    const resource = await getResourceByShortCode(db, shortCode);
    const autoDeleteSeconds = parseAutoDeleteSeconds(settings[GROUP_AUTO_DELETE_SECONDS_KEY]);
    const botUsername = ctx.me?.username ?? '';
    const title = resource?.title?.trim() || '未知资源';
    const guideText = resource
      ? [
          '点击下方按钮查看',
          `资源名称：${title}`,
          autoDeleteSeconds > 0 ? `此消息将在 ${autoDeleteSeconds} 秒后删除` : '',
        ].filter(Boolean).join('\n')
      : '资源不存在或短码有误。';
    const keyboard = resource
      ? new InlineKeyboard().url('查看资源', `https://t.me/${botUsername}?start=${shortCode}`)
      : undefined;
    const guideMsg = await ctx.reply(guideText, {
      reply_markup: keyboard,
    });
    if (
      autoDeleteSeconds > 0 &&
      ctx.chat?.id !== undefined &&
      ctx.msg?.message_id !== undefined
    ) {
      scheduleDeletion(
        ctx,
        ctx.chat.id,
        ctx.msg.message_id,
        [guideMsg.message_id],
        autoDeleteSeconds,
      );
    }
  });
}
