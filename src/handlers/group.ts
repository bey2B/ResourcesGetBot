/**
 * 群组处理器：群内发送纯短码消息时自动回复，支持配置自动删除。
 */

import type { Bot } from 'grammy';
import { getSettings } from '../db/queries';
import { parseBoolean } from '../utils/helpers';
import { isValidShortCode } from '../utils/shortcode';
import type { BotContext } from '../bot';
import { handleResourceRequest } from './resource';

export const GROUP_REPLY_ENABLED_KEY = 'group_reply_enabled';
export const GROUP_AUTO_DELETE_SECONDS_KEY = 'group_auto_delete_seconds';
export const DEFAULT_GROUP_AUTO_DELETE_SECONDS = 0;

/** 仅接受整条消息就是 8 位短码的文本，其他内容一律不回复。 */
export function extractPureShortCode(text: string): string | null {
  const trimmed = text.trim();
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

    const result = await handleResourceRequest(ctx, shortCode);
    const autoDeleteSeconds = parseAutoDeleteSeconds(settings[GROUP_AUTO_DELETE_SECONDS_KEY]);
    if (
      autoDeleteSeconds > 0 &&
      ctx.chat?.id !== undefined &&
      ctx.msg?.message_id !== undefined
    ) {
      scheduleDeletion(
        ctx,
        ctx.chat.id,
        ctx.msg.message_id,
        result.messageIds,
        autoDeleteSeconds,
      );
    }
  });
}
