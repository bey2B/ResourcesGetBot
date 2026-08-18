/**
 * /purchases 分页有序列表：每页固定 10 条，按资源序号排列；
 * 底部提供上一页/下一页，点击资源序号按钮直接调用 U3 delivery 服务发送全部文件。
 */

import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import {
  countPurchasedResources,
  getResourceById,
  hasPurchased,
  listPurchasedResources,
} from '../db/queries';
import { deliverResource } from '../services/delivery';
import type { Resource } from '../types';
import type { BotContext } from '../bot';
import { buildResourceCaption, ensureUser } from './resource';

export const PURCHASES_PAGE_SIZE = 10;
export const PURCHASES_PAGE_CALLBACK_PREFIX = 'purchases:page:';
export const PURCHASE_GET_CALLBACK_PREFIX = 'purchase:get:';
export const PURCHASES_EMPTY_TEXT = '你还没有购买过资源。发送付费资源短码即可用积分购买。';
export const PURCHASES_OWNER_ERROR_TEXT = '该操作不属于你，请发送 /purchases 查看自己的列表。';

const PURCHASES_CHAT_TYPES = ['private', 'group', 'supergroup'] as const;
const BUTTONS_PER_ROW = 5;

export function purchasesPageCallback(userId: number, page: number): string {
  return `${PURCHASES_PAGE_CALLBACK_PREFIX}${userId}:${page}`;
}

export function purchaseGetCallback(userId: number, resourceId: number): string {
  return `${PURCHASE_GET_CALLBACK_PREFIX}${userId}:${resourceId}`;
}

export function parsePurchasesPageCallback(
  data: string,
): { userId: number; page: number } | null {
  const raw = data.startsWith(PURCHASES_PAGE_CALLBACK_PREFIX)
    ? data.slice(PURCHASES_PAGE_CALLBACK_PREFIX.length)
    : '';
  const [userIdRaw, pageRaw] = raw.split(':');
  const userId = Number(userIdRaw);
  const page = Number(pageRaw);
  if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(page) || page <= 0) {
    return null;
  }
  return { userId, page };
}

export function parsePurchaseGetCallback(
  data: string,
): { userId: number; resourceId: number } | null {
  const raw = data.startsWith(PURCHASE_GET_CALLBACK_PREFIX)
    ? data.slice(PURCHASE_GET_CALLBACK_PREFIX.length)
    : '';
  const [userIdRaw, resourceIdRaw] = raw.split(':');
  const userId = Number(userIdRaw);
  const resourceId = Number(resourceIdRaw);
  if (
    !Number.isInteger(userId) ||
    userId <= 0 ||
    !Number.isInteger(resourceId) ||
    resourceId <= 0
  ) {
    return null;
  }
  return { userId, resourceId };
}

export function buildPurchasesPageText(
  resources: readonly Resource[],
  page: number,
  totalPages: number,
): string {
  if (resources.length === 0) {
    return PURCHASES_EMPTY_TEXT;
  }
  const lines = resources.map((resource, index) => {
    const number = (page - 1) * PURCHASES_PAGE_SIZE + index + 1;
    const title = resource.title.trim() || `资源 ${resource.short_code}`;
    return `${number}. ${title}`;
  });
  return `我已购买的资源·第 ${page}/${totalPages} 页\n\n${lines.join('\n')}`;
}

export function buildPurchasesKeyboard(
  resources: readonly Resource[],
  page: number,
  totalPages: number,
  userId: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  resources.forEach((resource, index) => {
    const number = (page - 1) * PURCHASES_PAGE_SIZE + index + 1;
    keyboard.text(String(number), purchaseGetCallback(userId, resource.id));
    if ((index + 1) % BUTTONS_PER_ROW === 0) {
      keyboard.row();
    }
  });
  if (resources.length > 0 && resources.length % BUTTONS_PER_ROW !== 0) {
    keyboard.row();
  }
  if (page > 1) {
    keyboard.text('上一页', purchasesPageCallback(userId, page - 1));
  }
  if (page < totalPages) {
    keyboard.text('下一页', purchasesPageCallback(userId, page + 1));
  }
  return keyboard;
}

function totalPurchasesPages(total: number): number {
  return total === 0 ? 0 : Math.ceil(total / PURCHASES_PAGE_SIZE);
}

function clampPage(page: number, totalPages: number): number {
  if (totalPages === 0) {
    return 1;
  }
  return Math.min(Math.max(page, 1), totalPages);
}

export async function showPurchasesPage(
  ctx: BotContext,
  userId: number,
  page = 1,
): Promise<void> {
  const db = ctx.env.DB;
  const total = await countPurchasedResources(db, userId);
  const totalPages = totalPurchasesPages(total);
  if (total === 0) {
    await ctx.reply(PURCHASES_EMPTY_TEXT);
    return;
  }
  const safePage = clampPage(page, totalPages);
  const resources = await listPurchasedResources(db, userId, {
    page: safePage,
    pageSize: PURCHASES_PAGE_SIZE,
  });
  await ctx.reply(buildPurchasesPageText(resources, safePage, totalPages), {
    reply_markup: buildPurchasesKeyboard(resources, safePage, totalPages, userId),
  });
}

function callbackActorId(ctx: BotContext): number | undefined {
  return ctx.callbackQuery?.from?.id;
}

export async function handlePurchasesPageCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? '';
  const parsed = parsePurchasesPageCallback(data);
  const actorId = callbackActorId(ctx);
  if (!parsed || actorId === undefined || parsed.userId !== actorId) {
    await ctx.answerCallbackQuery(PURCHASES_OWNER_ERROR_TEXT);
    return;
  }
  await ctx.answerCallbackQuery();
  const db = ctx.env.DB;
  const total = await countPurchasedResources(db, parsed.userId);
  const totalPages = totalPurchasesPages(total);
  const safePage = clampPage(parsed.page, totalPages);
  const resources = await listPurchasedResources(db, parsed.userId, {
    page: safePage,
    pageSize: PURCHASES_PAGE_SIZE,
  });
  await ctx.editMessageText(buildPurchasesPageText(resources, safePage, totalPages), {
    reply_markup: buildPurchasesKeyboard(resources, safePage, totalPages, parsed.userId),
  });
}

export async function handlePurchaseGetCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? '';
  const parsed = parsePurchaseGetCallback(data);
  const actorId = callbackActorId(ctx);
  if (!parsed || actorId === undefined || parsed.userId !== actorId) {
    await ctx.answerCallbackQuery(PURCHASES_OWNER_ERROR_TEXT);
    return;
  }
  const db = ctx.env.DB;
  const resource = await getResourceById(db, parsed.resourceId);
  const owned = resource
    ? await hasPurchased(db, parsed.userId, parsed.resourceId)
    : false;
  if (!resource || !owned || resource.is_paid !== 1 || resource.price <= 0) {
    await ctx.answerCallbackQuery('未找到该资源或无权获取');
    return;
  }
  const chatId = ctx.chat?.id;
  if (chatId === undefined) {
    await ctx.answerCallbackQuery('无法获取会话信息');
    return;
  }
  await ctx.answerCallbackQuery('正在发送资源，请稍候');
  await deliverResource(ctx.api, chatId, resource, {
    db,
    caption: buildResourceCaption(resource),
  });
}

export function registerPurchasesHandlers(bot: Bot<BotContext>): void {
  bot.chatType([...PURCHASES_CHAT_TYPES]).command('purchases', async (ctx) => {
    const user = await ensureUser(ctx);
    await showPurchasesPage(ctx, user.user_id, 1);
  });

  bot.chatType([...PURCHASES_CHAT_TYPES]).callbackQuery(
    new RegExp(`^${PURCHASES_PAGE_CALLBACK_PREFIX}\\d+:\\d+$`),
    async (ctx) => {
      await handlePurchasesPageCallback(ctx);
    },
  );

  bot.chatType([...PURCHASES_CHAT_TYPES]).callbackQuery(
    new RegExp(`^${PURCHASE_GET_CALLBACK_PREFIX}\\d+:\\d+$`),
    async (ctx) => {
      await handlePurchaseGetCallback(ctx);
    },
  );
}
