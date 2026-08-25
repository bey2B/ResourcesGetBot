/**
 * /start 入口：处理 deep link（?start=<shortcode>）、强制关注校验、新用户注册。
 * 短码统一小写处理。
 */

import type { Bot } from 'grammy';
import {
  createUserIfNotExists,
  getRequiredChannels,
  getUserById,
} from '../db/queries';
import { isAdminUserId } from '../utils/auth';
import { isValidShortCode } from '../utils/shortcode';
import type { BotContext } from '../bot';

export function parseStartPayload(payload: string | undefined): string | null {
  if (!payload) return null;
  const value = payload.trim();
  if (isValidShortCode(value.toLowerCase())) {
    return value.toLowerCase();
  }
  return null;
}

export function registerStartHandlers(bot: Bot<BotContext>): void {
  bot.chatType('private').command('start', async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    await createUserIfNotExists(ctx.env.DB, {
      userId: from.id,
      username: from.username ?? null,
      firstName: from.first_name,
      lastName: from.last_name ?? null,
    });
    const shortCode = parseStartPayload(ctx.match);
    if (shortCode) {
      // 交给 resource handler 的短码逻辑处理（含强制关注校验）。
      await ctx.reply(`正在为您获取资源 ${shortCode}…`);
      return;
    }
    const user = await getUserById(ctx.env.DB, from.id);
    const isAdmin = isAdminUserId({ ADMIN_IDS: ctx.env.ADMIN_IDS }, from.id);
    const channels = await getRequiredChannels(ctx.env.DB);
    const lines = [
      '欢迎使用资源分发 Bot！',
      '',
      '发送资源短码即可获取对应资源。',
      isAdmin ? '\n管理员命令：/admin 查看管理面板' : '',
      user ? `\n当前积分：${user.points}` : '',
    ];
    if (channels.length > 0) {
      lines.push('\n使用前请先加入以下频道：');
      channels.forEach((ch, i) => {
        lines.push(`${i + 1}. ${ch.channel_name}（${ch.channel_url}）`);
      });
    }
    await ctx.reply(lines.filter(Boolean).join('\n'));
  });
}
