/**
 * Cloudflare Workers 入口：webhook 处理 + 定时触发器（Cron Triggers）。
 * - POST /webhook：grammY webhook，校验 X-Telegram-Bot-Api-Secret-Token
 * - GET /healthz：健康检查
 * - Cron：每分钟检查待发送广播并执行，完成后通知管理员
 */

import { Bot, webhookCallback } from 'grammy';
import { createBot, type BotContext, type BotEnv } from './bot';
import { buildBroadcastReport } from './handlers/broadcast';
import {
  claimDueBroadcasts,
  getPendingBroadcasts,
  parseAdminIds,
} from './db/queries';
import { createTelegramDeliverer, executeBroadcast } from './handlers/broadcast';
import { utcNowIso } from './utils/helpers';

const CRON_BROADCAST_CHECK = 'broadcast-check';

interface Env extends BotEnv {
  WEBHOOK_SECRET?: string;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/healthz') {
      return new Response('ok', { status: 200 });
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      if (env.WEBHOOK_SECRET) {
        const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
        if (secret !== env.WEBHOOK_SECRET) {
          return new Response('unauthorized', { status: 401 });
        }
      }
      const botEnv: BotEnv = {
        DB: env.DB,
        BOT_TOKEN: env.BOT_TOKEN,
        ADMIN_IDS: env.ADMIN_IDS,
        waitUntil: (p) => ctx.waitUntil(p),
      };
      const bot = createBot(botEnv);
      const handleUpdate = webhookCallback(bot, 'cloudflare-mod');
      return handleUpdate(request);
    }

    return new Response('not found', { status: 404 });
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (controller.cron !== CRON_BROADCAST_CHECK) {
      return;
    }
    ctx.waitUntil(runDueBroadcasts(env));
  },
};

async function runDueBroadcasts(env: Env): Promise<void> {
  const now = utcNowIso();
  const due = await getPendingBroadcasts(env.DB, now);
  if (due.length === 0) {
    return;
  }
  const botEnv: BotEnv = {
    DB: env.DB,
    BOT_TOKEN: env.BOT_TOKEN,
    ADMIN_IDS: env.ADMIN_IDS,
  };
  const bot = createBot(botEnv);
  const deliverer = createTelegramDeliverer(bot.api);
  const adminIds = parseAdminIds(env.ADMIN_IDS);
  const notifyAdminId = adminIds[0] ?? 0;

  for (const row of due) {
    const claimed = await claimDueBroadcasts(env.DB, row.id);
    if (!claimed) {
      continue;
    }
    try {
      const report = await executeBroadcast(env.DB, row, deliverer);
      if (notifyAdminId > 0) {
        await bot.api.sendMessage(notifyAdminId, buildBroadcastReport(report));
      }
    } catch (err) {
      console.error('[cron-broadcast]', row.id, err);
      if (notifyAdminId > 0) {
        await bot.api
          .sendMessage(notifyAdminId, `广播 #${row.id} 执行失败：${String(err)}`)
          .catch(() => undefined);
      }
    }
  }
}
