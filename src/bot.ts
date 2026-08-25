/**
 * grammY Bot 实例与中间件组装。
 * createBot(env) 每次按 Worker env 构造实例；registerHandlers 可复用，
 * 供任务 5 追加 admin/broadcast handlers、任务 6 在 webhook 中挂载。
 */

import { Bot, Context } from 'grammy';
import { registerAdConfigHandlers } from './handlers/ad-config';
import { registerAdminHandlers } from './handlers/admin';
import {
  registerBroadcastConfirmationHandlers,
  registerBroadcastHandlers,
} from './handlers/broadcast';
import { registerGroupHandlers } from './handlers/group';
import { registerPointsHandlers } from './handlers/points';
import { registerPurchasesHandlers } from './handlers/purchases';
import { registerResourceHandlers, registerSubscriptionRecheckHandler } from './handlers/resource';
import { registerResourceStorageHandlers } from './handlers/resource-storage';
import { registerSettingsHandlers } from './handlers/settings';
import { registerStartHandlers } from './handlers/start';
import { errorMessage, normalizeError } from './utils/helpers';

export interface BotEnv {
  DB: D1Database;
  BOT_TOKEN: string;
  ADMIN_IDS: string;
  /** Worker 的 ctx.waitUntil，用于群组延迟删除等后台任务。 */
  waitUntil?: (promise: Promise<unknown>) => void;
}

export class BotContext extends Context {
  env!: BotEnv;
}

let activeBot: Bot<BotContext> | null = null;

/** 由 createBot 写入的默认实例，任务 6 可直接引用或改用 getBot/createBot。 */
export { activeBot as bot };

/** 返回缓存的 bot 实例；尚未创建时按当前 env 创建。 */
export function getBot(env: BotEnv): Bot<BotContext> {
  if (!activeBot) {
    activeBot = createBot(env);
  }
  return activeBot;
}

async function reportBotError(ctx: BotContext, err: unknown): Promise<void> {
  const error = normalizeError(err);
  console.error(
    `[bot-error] chat=${ctx.chatId ?? '-'} update=${ctx.update.update_id}`,
    error.message,
  );
  if (ctx.chatId === undefined) {
    return;
  }
  const userMessage = error.statusCode < 500 ? error.message : '操作失败，请稍后重试。';
  try {
    await ctx.api.sendMessage(ctx.chatId, userMessage);
  } catch {
    // 通知失败不阻塞主流程，避免错误级联。
  }
}

export function registerHandlers(botInstance: Bot<BotContext>): void {
  botInstance.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      await reportBotError(ctx, err);
    }
  });
  registerStartHandlers(botInstance);
  registerBroadcastConfirmationHandlers(botInstance);
  registerResourceStorageHandlers(botInstance);
  registerAdConfigHandlers(botInstance);
  registerResourceHandlers(botInstance);
  registerSubscriptionRecheckHandler(botInstance);
  registerGroupHandlers(botInstance);
  registerPointsHandlers(botInstance);
  registerPurchasesHandlers(botInstance);
  registerBroadcastHandlers(botInstance);
  registerAdminHandlers(botInstance);
  registerSettingsHandlers(botInstance);
}

export function createBot(env: BotEnv): Bot<BotContext> {
  const instance = new Bot<BotContext>(env.BOT_TOKEN, {
    ContextConstructor: BotContext,
  });
  instance.use(async (ctx, next) => {
    ctx.env = env;
    await next();
  });
  registerHandlers(instance);
  instance.catch((err) => {
    console.error('[bot-catch]', errorMessage(err.error));
  });
  activeBot = instance;
  return instance;
}
