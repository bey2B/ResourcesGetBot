/**
 * /start 处理器：普通欢迎语、邀请 Deep Link、资源短码 Deep Link。
 */

import type { Bot } from 'grammy';
import { getUser, upsertUser } from '../db/queries';
import { rewardInvite } from '../services/points';
import { checkForceSubscribe } from '../services/subscription';
import { isValidShortCode } from '../utils/shortcode';
import type { BotContext } from '../bot';
import { ensureUser, handleResourceRequest } from './resource';

export type StartPayload =
  | { type: 'none' }
  | { type: 'invalid' }
  | { type: 'invite'; inviterId: number }
  | { type: 'shortcode'; shortCode: string };

/** 解析 /start 参数：支持 start=inv_{user_id} 与 start={8位短码}。 */
export function parseStartPayload(payload: string | undefined): StartPayload {
  const value = payload?.trim() ?? '';
  if (!value) {
    return { type: 'none' };
  }
  const inviteMatch = /^inv_(\d{1,18})$/.exec(value);
  if (inviteMatch) {
    const inviterId = Number(inviteMatch[1]);
    if (Number.isSafeInteger(inviterId) && inviterId > 0) {
      return { type: 'invite', inviterId };
    }
    return { type: 'invalid' };
  }
  if (isValidShortCode(value.toLowerCase())) {
    return { type: 'shortcode', shortCode: value.toLowerCase() };
  }
  return { type: 'invalid' };
}

export function buildWelcomeText(ctx: BotContext): string {
  const username = ctx.me.username ?? 'bot';
  const userId = ctx.from?.id;
  const inviteLine = userId
    ? `\n\n你的专属邀请链接：\nhttps://t.me/${username}?start=inv_${userId}`
    : '';
  return (
    '欢迎使用 Cua 超级助手！\n' +
    '\n' +
    '在私聊或群组中发送资源短码即可获取资源，付费资源会扣除相应积分。\n' +
    '\n' +
    '每日发送「签到」可获得 1 积分，邀请好友成功可获得 5 积分。\n' +
    '\n' +
    '常用指令：\n' +
    '/start - 重新查看本说明\n' +
    '/points - 查看积分余额\n' +
    '/purchases - 查看我已购买的资源' +
    inviteLine
  );
}

async function notifyInviter(ctx: BotContext, inviterId: number, message: string): Promise<void> {
  try {
    await ctx.api.sendMessage(inviterId, message);
  } catch {
    // 机器人无法主动私聊未发起会话的用户时静默忽略。
  }
}

async function handleInviteStart(ctx: BotContext, inviterId: number): Promise<void> {
  const from = ctx.from;
  if (!from) {
    return;
  }
  const db = ctx.env.DB;
  const userId = from.id;
  if (inviterId === userId) {
    await ctx.reply(`不能通过自己的邀请链接获得积分。\n\n${buildWelcomeText(ctx)}`);
    return;
  }
  const inviter = await getUser(db, inviterId);
  const existing = await getUser(db, userId);
  if (!inviter) {
    await ensureUser(ctx);
    await ctx.reply(`邀请链接无效，邀请人不存在。\n\n${buildWelcomeText(ctx)}`);
    return;
  }
  if (existing) {
    // 新用户才生效：老用户不建立邀请关系，也不发放邀请奖励。
    await ensureUser(ctx);
    await ctx.reply(`你已经是老用户，邀请奖励仅对新用户有效。\n\n${buildWelcomeText(ctx)}`);
    return;
  }
  await upsertUser(db, {
    userId,
    username: from.username ?? null,
    firstName: from.first_name ?? null,
    invitedBy: inviterId,
  });
  const reward = await rewardInvite(db, inviterId, userId);
  if (reward.ok) {
    await ctx.reply(
      `欢迎使用 Cua 超级助手！\n\n你已通过邀请链接进入，邀请人获得 ${reward.change} 积分奖励。\n\n每日发送「签到」可获得 1 积分。`,
    );
    await notifyInviter(ctx, inviterId, reward.message);
  } else {
    await ctx.reply('欢迎使用 Cua 超级助手！\n\n你已通过邀请链接进入。');
  }
}

async function handleShortCodeStart(ctx: BotContext, shortCode: string): Promise<void> {
  const user = await ensureUser(ctx);
  const check = await checkForceSubscribe(ctx.env.DB, user.user_id, {
    botToken: ctx.env.BOT_TOKEN,
  });
  if (!check.ok) {
    await ctx.reply(check.message);
    return;
  }
  await handleResourceRequest(ctx, shortCode, { skipSubscriptionCheck: true });
}

export function registerStartHandlers(bot: Bot<BotContext>): void {
  bot.chatType('private').command('start', async (ctx) => {
    const payload = parseStartPayload(ctx.match);
    if (payload.type === 'invite') {
      await handleInviteStart(ctx, payload.inviterId);
      return;
    }
    if (payload.type === 'shortcode') {
      await handleShortCodeStart(ctx, payload.shortCode);
      return;
    }
    if (payload.type === 'invalid') {
      await ctx.reply('链接参数无效，请使用机器人提供的有效链接。');
      return;
    }
    await ctx.reply(buildWelcomeText(ctx));
  });
}
