/**
 * 群组处理器：群内收到短码时不直接发送资源，改为引导用户点击按钮跳转私聊获取。
 * 资源消息在群内发送后会自动删除，避免资源泄露到群历史。
 */

import { InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import { getResourceByShortCode } from '../db/queries';
import type { BotContext } from '../bot';

const SHORTCODE_RE = /^[a-z0-9]{8}$/i;
const GROUP_DELETE_DELAY_MS = 60_000;

/** 从群消息文本中提取纯短码（去除 @botname 后缀，统一小写）。 */
export function extractPureShortCode(text: string | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim().toLowerCase();
  if (!SHORTCODE_RE.test(trimmed)) return null;
  return trimmed;
}

function buildGroupGuideKeyboard(botUsername: string, shortCode: string): InlineKeyboard {
  return new InlineKeyboard().url(
    '点击获取资源',
    `https://t.me/${botUsername}?start=${shortCode}`,
  );
}

async function deleteMessageAfterDelay(
  ctx: BotContext,
  messageId: number,
  delayMs: number,
): Promise<void> {
  const run = async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    try {
      await ctx.api.deleteMessage(ctx.chatId as number, messageId);
    } catch {
      // 消息可能已被删除或无权限，静默忽略。
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

export function registerGroupHandlers(bot: Bot<BotContext>): void {
  bot.chatType(['group', 'supergroup']).on('message:text', async (ctx, next) => {
    const shortCode = extractPureShortCode(ctx.message.text);
    if (!shortCode) {
      await next();
      return;
    }
    const resource = await getResourceByShortCode(ctx.env.DB, shortCode);
    if (!resource) {
      await next();
      return;
    }
    const botInfo = await ctx.api.getMe();
    const botUsername = botInfo.username;
    const deleteDelaySec = Math.round(GROUP_DELETE_DELAY_MS / 1000);
    const text =
      `点击下方按钮查看\n` +
      `资源名称：${resource.title || '未命名资源'}\n` +
      `此消息将在 ${deleteDelaySec} 秒后删除`;
    const sent = await ctx.reply(text, {
      reply_markup: buildGroupGuideKeyboard(botUsername, shortCode),
    });
    await deleteMessageAfterDelay(ctx, sent.message_id, GROUP_DELETE_DELAY_MS);
  });
}
