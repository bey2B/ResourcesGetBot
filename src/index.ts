/**
 * Worker 入口：健康检查、Telegram webhook、Cron 定时任务分发。
 * 每次 webhook 请求按当前 env 构造 bot 实例，保证 D1 与 waitUntil 注入正确；
 * Cron 复用同一套广播执行引擎发送定时广播。
 */

import { webhookCallback } from 'grammy';
import { createBot, type BotEnv } from './bot';
import {
  runBroadcastCron,
  runDailyMaintenance,
  runStatsPreaggregation,
} from './cron';
import { createTelegramDeliverer, buildBroadcastReport } from './handlers/broadcast';
import type { Env } from './types';
import { errorMessage, jsonResponse } from './utils/helpers';
import { parseAdminIds } from './utils/auth';

const SERVICE_NAME = 'cua-super-bot';
const WEBHOOK_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/** 每日 UTC 0 点：清理过期签到记录与限流记录。 */
const CRON_DAILY_MAINTENANCE = '0 0 * * *';
/** 每 15 分钟：检查并执行到期的定时广播。 */
const CRON_BROADCAST_CHECK = '*/15 * * * *';
/** 每分钟：广播分批续发的主力触发器，同时兜底恢复陈旧 sending。 */
const CRON_BROADCAST_TICK = '* * * * *';
/** 每日 UTC 0:30：预聚合统计快照，避开 0 点维护任务。 */
const CRON_STATS_PREAGGREGATION = '30 0 * * *';

/**
 * 广播检查的共用实现：每轮先恢复陈旧 sending，再让每条到期广播各发一个批次。
 * 只在「全部发完」或出错时通知管理员，避免每分钟刷屏；批次进度写 console 日志。
 */
async function runBroadcastTick(env: Env): Promise<void> {
  const bot = createBot(buildBotEnv(env));
  const result = await runBroadcastCron(env.DB, createTelegramDeliverer(bot.api));
  console.log(
    `[cron] broadcast tick: due=${result.checked} recovered=${result.recovered} executed=${result.executed.length} errors=${result.errors.length}`,
  );
  for (const report of result.executed) {
    if (!report.finished) {
      console.log(
        `[cron] broadcast #${report.broadcastId} batch done: processed=${report.processed} success=${report.success} fail=${report.fail} skip=${report.skip} next=${report.nextScheduledAt ?? '-'}`,
      );
    }
  }
  if (result.errors.length > 0) {
    console.error('[cron] broadcast errors', result.errors.join('; '));
  }
  const finishedReports = result.executed.filter((report) => report.finished);
  // 没有广播彻底发完、也没有错误时，不打扰管理员。
  if (finishedReports.length === 0 && result.errors.length === 0) {
    return;
  }
  const adminIds = parseAdminIds(env.ADMIN_IDS);
  const firstAdmin = adminIds[0];
  if (!firstAdmin) {
    return;
  }
  const lines: string[] = [];
  for (const report of finishedReports) {
    lines.push(buildBroadcastReport(report));
  }
  for (const err of result.errors) {
    lines.push(`⚠️ ${err}`);
  }
  try {
    await bot.api.sendMessage(firstAdmin, lines.join('\n\n---\n\n'));
  } catch (err) {
    console.error('[cron] notify admin failed', errorMessage(err));
  }
}

const CRON_HANDLERS: Record<string, (env: Env) => Promise<void>> = {
  [CRON_DAILY_MAINTENANCE]: async (env) => {
    const result = await runDailyMaintenance(env.DB);
    console.log(
      `[cron] daily maintenance: clearedCheckins=${result.clearedCheckins} clearedRateLimits=${result.clearedRateLimits}`,
    );
  },
  [CRON_BROADCAST_CHECK]: runBroadcastTick,
  [CRON_BROADCAST_TICK]: runBroadcastTick,
  [CRON_STATS_PREAGGREGATION]: async (env) => {
    const result = await runStatsPreaggregation(env.DB);
    console.log(
      `[cron] stats preaggregation: snapshot=${result.snapshotKey} removed=${result.removedSnapshots.length}`,
    );
  },
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (url.pathname === '/health') {
      if (method !== 'GET') {
        return methodNotAllowed(['GET']);
      }
      return Response.json({
        ok: true,
        service: SERVICE_NAME,
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === '/') {
      if (method !== 'GET') {
        return methodNotAllowed(['GET']);
      }
      return Response.json({
        ok: true,
        service: SERVICE_NAME,
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === '/webhook') {
      if (method !== 'POST') {
        return methodNotAllowed(['POST']);
      }
      return handleWebhook(request, env, ctx);
    }

    return jsonResponse({ ok: false, error: 'Not Found' }, { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const handler = CRON_HANDLERS[controller.cron];
    if (!handler) {
      console.warn(`[cron] unknown trigger: ${controller.cron}`);
      return;
    }
    const startedAt = Date.now();
    console.log(`[cron] start trigger=${controller.cron} scheduledTime=${controller.scheduledTime}`);
    try {
      await handler(env);
      console.log(`[cron] finished trigger=${controller.cron} ms=${Date.now() - startedAt}`);
    } catch (err) {
      console.error(`[cron] failed trigger=${controller.cron}`, errorMessage(err));
    }
  },
} satisfies ExportedHandler<Env>;

function buildBotEnv(env: Env, ctx?: ExecutionContext): BotEnv {
  return {
    DB: env.DB,
    BOT_TOKEN: env.BOT_TOKEN,
    ADMIN_IDS: env.ADMIN_IDS,
    waitUntil: ctx ? (promise) => ctx.waitUntil(promise) : undefined,
  };
}

function methodNotAllowed(allow: string[]): Response {
  return jsonResponse(
    { ok: false, error: 'Method Not Allowed' },
    {
      status: 405,
      headers: { Allow: allow.join(', ') },
    },
  );
}

/** 常量时间比较，避免通过响应时间探测 webhook secret。 */
function secretEquals(expected: string, actual: string): boolean {
  const expectedBytes = new TextEncoder().encode(expected);
  const actualBytes = new TextEncoder().encode(actual);
  if (expectedBytes.length !== actualBytes.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= expectedBytes[index] ^ actualBytes[index];
  }
  return difference === 0;
}

async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const configuredSecret = env.WEBHOOK_SECRET?.trim();
  if (configuredSecret) {
    const received = request.headers.get(WEBHOOK_SECRET_HEADER) ?? '';
    if (!secretEquals(configuredSecret, received)) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }
  if (!env.BOT_TOKEN?.trim()) {
    // BOT_TOKEN 未配置时直接返回 503，避免 webhook 回调触发 getMe 请求后崩溃。
    console.error('[webhook] BOT_TOKEN is not configured');
    return jsonResponse({ ok: false, error: 'Service Unavailable' }, { status: 503 });
  }
  const bot = createBot(buildBotEnv(env, ctx));
  const webhook = webhookCallback(bot, 'cloudflare-mod', {
    timeoutMilliseconds: Infinity,
  });
  try {
    return await webhook(request);
  } catch (err) {
    const badPayload = err instanceof SyntaxError;
    console.error(`[webhook-error] badPayload=${badPayload}`, errorMessage(err));
    return jsonResponse(
      { ok: false, error: badPayload ? 'Bad Request' : 'Internal Error' },
      { status: badPayload ? 400 : 500 },
    );
  }
}
