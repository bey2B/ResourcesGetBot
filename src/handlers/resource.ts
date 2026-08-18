/**
 * 资源处理器：短码查询、限流、强制关注、免费/付费购买与文件交付。
 */

import type { Bot } from 'grammy';
import { InputMediaBuilder } from 'grammy';
import {
  getResourceByShortCode,
  getSetting,
  hasDownloaded,
  recordDownload,
  recordDownloadIfAbsent,
  upsertUser,
} from '../db/queries';
import { getAdForPosition } from '../services/ads';
import { consumeRateLimit } from '../services/rate-limit';
import { purchaseResource } from '../services/points';
import { checkForceSubscribe } from '../services/subscription';
import type { Resource, User } from '../types';
import { AppError, errorMessage, parseBoolean } from '../utils/helpers';
import { isValidShortCode } from '../utils/shortcode';
import type { BotContext } from '../bot';

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

export function parseResourceFileIds(resource: Resource): string[] {
  if (resource.file_ids?.trim()) {
    try {
      const parsed = JSON.parse(resource.file_ids) as unknown;
      if (Array.isArray(parsed)) {
        const ids = parsed
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0);
        if (ids.length > 0) {
          return [...new Set(ids)];
        }
      }
    } catch {
      // file_ids 损坏时回退到 file_id 单文件发送
    }
  }
  return [resource.file_id];
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

/** 消息块策略：单文件始终单发；多文件时按“一个文件一个消息块”开关决定拆分或合并。 */
export function decideFileBlockMode(fileCount: number, oneFilePerBlock: boolean): FileBlockMode {
  if (fileCount <= 1) {
    return 'single';
  }
  return oneFilePerBlock ? 'separate' : 'media_group';
}

/**
 * 数据库只保存 file_id，不区分媒体类型，因此按常见类型逐类尝试发送。
 * 真实场景下首次尝试即命中对应类型，失败回退不会影响已有流程。
 */
async function sendFileId(ctx: BotContext, fileId: string, caption?: string): Promise<number> {
  const chatId = requireChatId(ctx);
  const captionOptions = caption ? { caption } : undefined;
  const attempts: Array<() => Promise<{ message_id: number }>> = [
    () => ctx.api.sendDocument(chatId, fileId, captionOptions),
    () => ctx.api.sendPhoto(chatId, fileId, captionOptions),
    () => ctx.api.sendVideo(chatId, fileId, captionOptions),
    () => ctx.api.sendAnimation(chatId, fileId, captionOptions),
    () => ctx.api.sendAudio(chatId, fileId, captionOptions),
    () => ctx.api.sendVoice(chatId, fileId, captionOptions),
    () => ctx.api.sendVideoNote(chatId, fileId),
    () => ctx.api.sendSticker(chatId, fileId),
  ];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const message = await attempt();
      return message.message_id;
    } catch (err) {
      lastError = err;
    }
  }
  throw new AppError(`资源文件发送失败，请稍后重试或联系管理员。（${errorMessage(lastError)}）`);
}

export async function sendResourceFiles(
  ctx: BotContext,
  fileIds: readonly string[],
  caption?: string,
): Promise<number[]> {
  const files = fileIds.filter((fileId) => typeof fileId === 'string' && fileId.trim().length > 0);
  if (files.length === 0) {
    throw new AppError('资源文件缺失，请稍后重试或联系管理员', 500, 'RESOURCE_FILE_MISSING');
  }
  const oneFilePerBlock = parseBoolean(
    await getSetting(ctx.env.DB, MESSAGE_BLOCK_ENABLED_KEY),
    false,
  );
  const mode = decideFileBlockMode(files.length, oneFilePerBlock);
  if (mode === 'single' || mode === 'separate') {
    const messageIds: number[] = [];
    for (let index = 0; index < files.length; index += 1) {
      messageIds.push(
        await sendFileId(ctx, files[index], index === 0 ? caption : undefined),
      );
    }
    return messageIds;
  }

  // 合并消息块：统一按 document 组装媒体组，失败时退回逐条发送。
  try {
    const media = files.map((fileId, index) =>
      InputMediaBuilder.document(
        fileId,
        index === 0 && caption ? { caption } : {},
      ),
    );
    const messages = await ctx.api.sendMediaGroup(requireChatId(ctx), media);
    return messages.map((message) => message.message_id);
  } catch {
    const messageIds: number[] = [];
    for (let index = 0; index < files.length; index += 1) {
      messageIds.push(
        await sendFileId(ctx, files[index], index === 0 ? caption : undefined),
      );
    }
    return messageIds;
  }
}

export async function handleResourceRequest(
  ctx: BotContext,
  shortCode: string,
  options: ResourceRequestOptions = {},
): Promise<ResourceDeliveryResult> {
  const messageIds: number[] = [];
  const db = ctx.env.DB;
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
      await replyAndTrack(ctx, check.message, messageIds);
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
      // 已购付费资源不重复记账，避免“我已购买”列表出现重复条目。
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

  const [topAd, bottomAd] = await Promise.all([
    getAdForPosition(db, 'top'),
    getAdForPosition(db, 'bottom'),
  ]);
  const fileMessageIds = await sendResourceFiles(
    ctx,
    parseResourceFileIds(resource),
    buildResourceCaption(resource, topAd?.content, bottomAd?.content),
  );
  messageIds.push(...fileMessageIds);
  return { delivered: true, messageIds };
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
