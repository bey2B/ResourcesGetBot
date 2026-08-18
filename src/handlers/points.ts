/**
 * 积分处理器：签到、余额查询、已购资源列表。
 */

import type { Bot } from 'grammy';
import {
  dailyCheckIn,
  getPointsBalance,
  getPurchaseRecords,
} from '../services/points';
import type { Resource } from '../types';
import type { BotContext } from '../bot';
import { ensureUser } from './resource';

const POINTS_CHAT_TYPES = ['private', 'group', 'supergroup'] as const;

export function buildPurchasedResourcesText(records: readonly Resource[]): string {
  if (records.length === 0) {
    return '你还没有购买过资源。发送付费资源短码即可用积分购买。';
  }
  const lines = records.map((resource, index) => {
    const title = resource.title.trim() || `资源 ${resource.short_code}`;
    return `${index + 1}. ${title}\n   短码：${resource.short_code}｜价格：${resource.price} 积分`;
  });
  return `我已购买的资源（共 ${records.length} 个）：\n${lines.join('\n')}`;
}

export function registerPointsHandlers(bot: Bot<BotContext>): void {
  bot.chatType([...POINTS_CHAT_TYPES]).hears('签到', async (ctx) => {
    const user = await ensureUser(ctx);
    const result = await dailyCheckIn(ctx.env.DB, user.user_id);
    await ctx.reply(result.message);
  });

  bot.chatType([...POINTS_CHAT_TYPES]).hears(['积分', '我的积分'], async (ctx) => {
    const user = await ensureUser(ctx);
    const result = await getPointsBalance(ctx.env.DB, user.user_id);
    await ctx.reply(result.message);
  });

  bot.chatType([...POINTS_CHAT_TYPES]).hears('我已购买的资源', async (ctx) => {
    const user = await ensureUser(ctx);
    const records = await getPurchaseRecords(ctx.env.DB, user.user_id);
    await ctx.reply(buildPurchasedResourcesText(records));
  });

  bot.chatType([...POINTS_CHAT_TYPES]).command('points', async (ctx) => {
    const user = await ensureUser(ctx);
    const result = await getPointsBalance(ctx.env.DB, user.user_id);
    await ctx.reply(result.message);
  });
}
