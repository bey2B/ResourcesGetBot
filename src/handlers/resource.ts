/**
 * 资源处理器：短码查询、限流、强制关注、免费/付费购买与文件交付。
 */

import { InlineKeyboard, type Bot } from 'grammy';
import {
  getResourceByShortCode,
  hasDownloaded,
  recordDownload,
  recordDownloadIfAbsent,
  upsertUser,
} from '../db/queries';
import { sendAdForPosition } from '../services/ads';
import { deliverResource } from '../services/delivery';
import { consumeRateLimit } from '../services/rate-limit';
import { purchaseResource } from '../services/points';
import { checkForceSubscribe } from '../services/subscription';
import type { AdPosition, Resource, User } from '../types';
import { AppError, errorMessage } from '../utils/helpers';
import { isValidShortCode } from '../utils/shortcode';
import type { BotContext } from '../bot';

export { parseResourceFileIds } from '../services/delivery';
export const MESSAGE_BLOCK_ENABLED_KEY = 'message_block_enabled';

export interface ResourceRequestOptions {
  /** 已在 start 流程完成强制关注校验时传 true，避免重复请求 Telegram API。 */
  skipSubscriptionCheck?: boolean;
}

export interface ResourceDeliveryResult {
  delivered: boolean;
  /** 本次请求中机器人发出的消息 ID，供群组自动删除使用。 */
  messageIds: number[];
}

export type ResourceDeliveryDecision =
  | { type: 'invalid_code' }
  | { type: 'user_not_found' }
  | { type: 'banned' }
  | { type: 'resource_not_found' }
  | { type: 'rate_limited'; message: string }
  | { type: 'subscribe_required' }
  | { type: 'purchase_required'; price: number }
  | { type: 'deliver_owned' }
  | { type: 'deliver_free' };

export interface ResourceDecisionInput {
  codeValid: boolean;
  user: User | null;
  resource: Resource | null;
  rateLimitAllowed: boolean;
  rateLimitMessage: string;
  subscriptionOk: boolean | null;
  owned: boolean;
}

/** 纯函数决策：把免费/付费、限流、封禁等分支收敛到一处，便于单元冒烟验证。 */
export function decideResourceDelivery(input: ResourceDecisionInput): ResourceDeliveryDecision {
  if (!input.codeValid) {
    return { type: 'invalid_code' };
  }
  if (!input.user) {
    return { type: 'user_not_found' };
  }
  if (input.user.is_banned) {
    return { type: 'banned' };
  }
  if (!input.resource) {
    return { type: 'resource_not_found' };
  }
  if (!input.rateLimitAllowed) {
    return { type: 'rate_limited', message: input.rateLimitMessage };
  }
  if (input.subscriptionOk === false) {
    return { type: 'subscribe_required' };
  }
  const paid = input.resource.is_paid === 1 && input.resource.price > 0;
  if (paid && !input.owned) {
    return { type: 'purchase_required', price: input.resource.price };
  }
  if (paid && input.owned) {
    return { type: 'deliver_owned' };
  }
  return { type: 'deliver_free' };
}

export async function ensureUser(ctx: BotContext): Promise<User> {
  const from = ctx.from;
  if (!from || !Number.isInteger(from.id) || from.id <= 0) {
    throw new AppError('无法获取有效的用户信息', 400, 'VALIDATION_ERROR');
  }
  return upsertUser(ctx.env.DB, {
    userId: from.id,
    username: from.username ?? null,
    firstName: from.first_name ?? null,
  });
}

function requireChatId(ctx: BotContext): number {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) {
    throw new AppError('无法获取会话信息', 400, 'VALIDATION_ERROR');
  }
  return chatId;
}

async function replyAndTrack(
  ctx: BotContext,
  text: string,
  messageIds: number[],
): Promise<void> {
  const message = await ctx.api.sendMessage(requireChatId(ctx), text);
  messageIds.push(message.message_id);
}

export function buildResourceCaption(
  resource: Resource,
  topAdContent?: string,
  bottomAdContent?: string,
): string {
  const lines: string[] = [];
  if (topAdContent?.trim()) {
    lines.push(topAdContent.trim());
  }
  const title = resource.title.trim();
  if (title) {
    lines.push(title);
  }
  const tags = resource.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join('、');
  if (tags) {
    lines.push(`标签：${tags}`);
  }
  if (resource.is_paid === 1 && resource.price > 0) {
    lines.push(`价格：${resource.price} 积分`);
  }
  if (bottomAdContent?.trim()) {
    lines.push(bottomAdContent.trim());
  }
  const caption = lines.join('\n');
  // Telegram 单条消息 caption 上限约 1024 字符，超长时截断
  return caption.length > 1024 ? `${caption.slice(0, 1021)}...` : caption;
}

export type FileBlockMode = 'single' | 'separate' | 'media_group';

/** 旧消息块策略，保留给现有测试与 settings 兼容；U3 起投递统一走 services/delivery。 */
export function decideFileBlockMode(fileCount: number, oneFilePerBlock: boolean): FileBlockMode {
  if (fileCount <= 1) {
    return 'single';
  }
  return oneFilePerBlock ? 'separate' : 'media_group';
}

export async function handleResourceRequest(
  ctx: BotContext,
  shortCode: string,
  options: ResourceRequestOptions = {},
): Promise<ResourceDeliveryResult> {
  const messageIds: number[] = [];
  const db = ctx.env.DB;
  // 统一转小写，兼容历史大写短码与用户大小写混合输入
  shortCode = shortCode.toLowerCase();
  const codeValid = isValidShortCode(shortCode);
  if (!codeValid) {
    await replyAndTrack(ctx, '短码格式不正确，请输入 8 位资源短码。', messageIds);
    return { delivered: false, messageIds };
  }
  const user = await ensureUser(ctx);
  const resource = await getResourceByShortCode(db, shortCode);
  if (!resource) {
    await replyAndTrack(ctx, '未找到该资源，短码可能已失效或输入有误。', messageIds);
    return { delivered: false, messageIds };
  }
  const rateLimit = await consumeRateLimit(db, user.user_id, resource.id);
  let subscriptionOk: boolean | null = null;
  if (rateLimit.allowed && !options.skipSubscriptionCheck) {
    const check = await checkForceSubscribe(db, user.user_id, {
      botToken: ctx.env.BOT_TOKEN,
    });
    subscriptionOk = check.ok;
    if (!check.ok) {
      const keyboard = new InlineKeyboard();
      const noLinkChannels: string[] = [];
      for (const ch of check.channels.filter((c) => c.status === 'not_member')) {
        const url = ch.inviteUrl || (ch.channel.startsWith('@')
          ? `https://t.me/${ch.channel.slice(1)}`
          : null);
        if (url) {
          keyboard.url(`🔥烧鸡收藏夹|清澈分类`, url).row();
        } else {
          noLinkChannels.push(ch.display);
        }
      }
      keyboard.text('✅我已加入', `sub_recheck:${shortCode}`);
      const lines = ['⬇️您需要加入以下频道才能使用：'];
      if (noLinkChannels.length > 0) {
        lines.push(noLinkChannels.join('\n'));
      }
      const msg = await ctx.reply(lines.join('\n'), { reply_markup: keyboard });
      messageIds.push(msg.message_id);
      return { delivered: false, messageIds };
    }
  }
  const owned = await hasDownloaded(db, user.user_id, resource.id);
  const decision = decideResourceDelivery({
    codeValid,
    user,
    resource,
    rateLimitAllowed: rateLimit.allowed,
    rateLimitMessage: rateLimit.message,
    subscriptionOk,
    owned,
  });
  switch (decision.type) {
    case 'user_not_found':
      await replyAndTrack(ctx, '用户不存在，请先发送 /start 注册。', messageIds);
      return { delivered: false, messageIds };
    case 'banned':
      await replyAndTrack(ctx, '账号已被封禁，无法获取资源。', messageIds);
      return { delivered: false, messageIds };
    case 'rate_limited':
      await replyAndTrack(ctx, decision.message, messageIds);
      return { delivered: false, messageIds };
    case 'purchase_required': {
      const purchase = await purchaseResource(db, user.user_id, resource.id);
      if (!purchase.ok) {
        await replyAndTrack(ctx, purchase.message, messageIds);
        return { delivered: false, messageIds };
      }
      await replyAndTrack(ctx, purchase.message, messageIds);
      break;
    }
    case 'deliver_owned':
      // 已购付费资源不重复记账，避免"我已购买"列表出现重复条目。
      await recordDownloadIfAbsent(db, user.user_id, resource.id);
      await replyAndTrack(ctx, '你已购买过该资源，再次为你发送。', messageIds);
      break;
    case 'deliver_free':
      await recordDownload(db, user.user_id, resource.id);
      break;
    case 'subscribe_required':
    case 'invalid_code':
    case 'resource_not_found':
      // 这些分支在进入 switch 前已处理完毕。
      return { delivered: false, messageIds };
  }
  const chatId = requireChatId(ctx);
  await sendIndependentAd(ctx, chatId, 'top', messageIds);
  const delivery = await deliverResource(ctx.api, chatId, resource, {
    db,
    caption: buildResourceCaption(resource),
  });
  messageIds.push(...delivery.messageIds);
  await sendIndependentAd(ctx, chatId, 'bottom', messageIds);
  return { delivered: true, messageIds };
}

/** 广告位独立消息发送失败时不阻断资源投递，只记录日志。 */
async function sendIndependentAd(
  ctx: BotContext,
  chatId: number,
  position: AdPosition,
  messageIds: number[],
): Promise<void> {
  try {
    const messageId = await sendAdForPosition(ctx.api, ctx.env.DB, chatId, position);
    if (messageId !== null) {
      messageIds.push(messageId);
    }
  } catch (err) {
    console.error(`[ad-send] ${position}`, errorMessage(err));
  }
}

export function registerResourceHandlers(bot: Bot<BotContext>): void {
  bot.chatType('private').on(':text', async (ctx, next) => {
    const text = ctx.message.text;
    if (!text) {
      await next();
      return;
    }
    const shortCode = text.trim();
    if (!isValidShortCode(shortCode)) {
      await next();
      return;
    }
    await handleResourceRequest(ctx, shortCode);
  });
}

/** "我已加入"按钮回调：重新校验订阅状态，通过则继续资源投递。 */
export function registerSubscriptionRecheckHandler(bot: Bot<BotContext>): void {
  bot.callbackQuery(/^sub_recheck:(.+)$/, async (ctx) => {
    const shortCode = ctx.match?.[1] ?? '';
    if (!shortCode) {
      await ctx.answerCallbackQuery('短码无效');
      return;
    }
    await ctx.answerCallbackQuery('正在验证，请稍候...');
    await handleResourceRequest(ctx, shortCode);
  });
}
