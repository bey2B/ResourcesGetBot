/**
 * 管理员命令入口：媒体转发自动入库、资源维护、统计报告与操作日志。
 * 仅 ADMIN_IDS 中配置的 user_id 可用；媒体说明以 /bc 开头时交给广播处理器。
 */

import type { Bot } from 'grammy';
import {
  countResources,
  createResource,
  deleteResource,
  getResourceById,
  getResourceByShortCode,
  listAdminLogs,
  listResources,
  updateResource,
  type ResourceRow,
} from '../db/queries';
import { getStatsDashboard } from '../services/stats';
import { isAdminUserId } from '../utils/auth';
import { formatLocalDateTime, parseBoolean } from '../utils/helpers';
import { generateUniqueShortCode } from '../utils/shortcode';
import type { BotContext } from '../bot';
import {
  extractMediaFromMessage,
  getMessageCaption,
  isBroadcastCaptionCommand,
  safeWriteAdminLog,
} from './broadcast';

const ADMIN_HELP = `管理员命令：
/admin - 查看本帮助
转发媒体给本 Bot - 自动入库（说明中可写标题、标签、价格）
/res_list [页码] - 资源列表
/res_del <短码|ID> - 删除资源
/res_price <短码|ID> <积分> - 设置付费价格并开启付费
/res_paid <短码|ID> <on|off> - 开关付费
/res_set <短码|ID> title|tags <内容> - 修改标题或标签
/stats - 近 7 日数据统计
/logs [条数] - 查看操作日志
/settings - 查看/修改系统设置
/bc - 广播与定时广播（发送 /bc 查看帮助）`;

export interface ParsedResourceMeta {
  title: string;
  tags: string;
  isPaid: boolean;
  price: number;
}

const TAG_LINE_RE = /^\s*(标签|tags)\s*[:：]\s*(.+)$/i;
const PRICE_LINE_RE = /^\s*(价格|付费)\s*[:：]?\s*(\d{1,9})\s*$/i;

/** 解析媒体说明：首行标题，#标签 或 标签：xx 行，价格：N / 付费 N 行。 */
export function parseResourceCaption(caption: string | undefined): ParsedResourceMeta {
  const lines = (caption ?? '').split(/\r?\n/);
  let title = '';
  const tagParts: string[] = [];
  let price = 0;
  let isPaid = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const tagMatch = TAG_LINE_RE.exec(line);
    if (tagMatch) {
      tagParts.push(
        ...tagMatch[2]
          .split(/[,，\s]+/)
          .map((tag) => tag.trim().replace(/^#/, ''))
          .filter(Boolean),
      );
      continue;
    }
    const priceMatch = PRICE_LINE_RE.exec(line);
    if (priceMatch) {
      price = Number(priceMatch[2]);
      isPaid = price > 0;
      continue;
    }
    const hashTags = line.match(/#([A-Za-z0-9_]+)/g);
    if (hashTags) {
      tagParts.push(...hashTags.map((tag) => tag.slice(1)));
    }
    if (!title) {
      title = line;
    }
  }

  return {
    title,
    tags: [...new Set(tagParts)].join(','),
    isPaid,
    price,
  };
}

export function getAdminId(ctx: BotContext): number | null {
  const from = ctx.from;
  if (!from || !isAdminUserId({ ADMIN_IDS: ctx.env.ADMIN_IDS }, from.id)) {
    return null;
  }
  return from.id;
}

export async function requireAdmin(ctx: BotContext): Promise<number | null> {
  const adminId = getAdminId(ctx);
  if (adminId === null) {
    await ctx.reply('无权限：仅管理员可使用该功能。');
    return null;
  }
  return adminId;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number((value ?? '').trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function resolveResource(db: D1Database, raw: string): Promise<ResourceRow | null> {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const byId = await getResourceById(db, Number(trimmed));
    if (byId) {
      return byId;
    }
  }
  return getResourceByShortCode(db, trimmed);
}

function buildResourceBrief(resource: ResourceRow): string {
  const lines = [
    `#${resource.sequence} 短码：${resource.short_code}`,
    `标题：${resource.title.trim() || '-'}`,
  ];
  if (resource.tags.trim()) {
    lines.push(`标签：${resource.tags.split(',').filter(Boolean).join('、')}`);
  }
  const priceLine =
    resource.is_paid === 1 && resource.price > 0
      ? `付费 ${resource.price} 积分`
      : '免费';
  lines.push(`状态：${priceLine}｜下载：${resource.download_count}`);
  return lines.join('\n');
}

function buildResourceSavedText(resource: ResourceRow): string {
  const status =
    resource.is_paid === 1 && resource.price > 0
      ? `付费 ${resource.price} 积分`
      : '免费';
  return [
    '资源已保存',
    `短码：${resource.short_code}`,
    `序号：${resource.sequence}`,
    `标题：${resource.title.trim() || '-'}`,
    `标签：${resource.tags ? resource.tags.split(',').join('、') : '-'}`,
    `状态：${status}`,
    '用户发送该短码即可获取资源。',
  ].join('\n');
}

function buildBar(value: number, max: number, width = 10): string {
  if (max <= 0) {
    return '-'.repeat(width);
  }
  const count = Math.max(0, Math.round((value / max) * width));
  return '#'.repeat(count) + '-'.repeat(width - count);
}

function buildStatsText(db: D1Database): Promise<string> {
  return getStatsDashboard(db, 7).then((stats) => {
    const lines: string[] = ['近 7 日数据报告', '-- 总览 --'];
    lines.push(
      `总用户 ${stats.overview.totalUsers}｜资源 ${stats.overview.totalResources}｜下载 ${stats.overview.totalDownloads}｜封禁 ${stats.overview.bannedUsers}`,
    );
    lines.push(
      `今日新增 ${stats.overview.todayNewUsers}｜今日活跃 ${stats.overview.todayActiveUsers}｜今日下载 ${stats.overview.todayDownloads}｜今日签到 ${stats.overview.todayCheckins}`,
    );

    lines.push('-- 近 7 日趋势（UTC 日期）--');
    stats.trend.newUsers.forEach((day, index) => {
      const active = stats.trend.activeUsers[index]?.count ?? 0;
      const downloads = stats.trend.downloads[index]?.count ?? 0;
      lines.push(`${day.date.slice(5)} 新增 ${day.count}｜活跃 ${active}｜下载 ${downloads}`);
    });

    lines.push('-- 24 小时热力图（UTC）--');
    const activity = stats.hourly.hourlyActivity;
    const max = Math.max(1, ...activity.map((item) => item.count));
    const chunks: string[] = [];
    for (let start = 0; start < activity.length; start += 6) {
      chunks.push(
        activity
          .slice(start, start + 6)
          .map((item) => `${String(item.hour).padStart(2, '0')} ${buildBar(item.count, max, 8)}`)
          .join('  '),
      );
    }
    lines.push(chunks.join('\n'));

    lines.push('-- 积分循环 --');
    lines.push(
      `发放 ${stats.pointsCycle.issued}｜消耗 ${stats.pointsCycle.spent}｜净流入 ${stats.pointsCycle.net}`,
    );
    stats.pointsCycle.byReason.slice(0, 5).forEach((item) => {
      lines.push(`${item.reason}：${item.totalChange > 0 ? '+' : ''}${item.totalChange}（${item.count} 次）`);
    });

    lines.push('-- 热门资源 Top 5 --');
    stats.topResources.slice(0, 5).forEach((resource, index) => {
      lines.push(
        `${index + 1}. ${resource.title.trim() || resource.short_code}｜短码 ${resource.short_code}｜下载 ${resource.download_count}`,
      );
    });
    return lines.join('\n');
  });
}

export function registerAdminHandlers(bot: Bot<BotContext>): void {
  bot.chatType('private').command('admin', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    await ctx.reply(ADMIN_HELP);
  });

  bot.chatType('private').command('res_list', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const page = parsePositiveInt(ctx.match, 1);
    const pageSize = 20;
    const [resources, total] = await Promise.all([
      listResources(ctx.env.DB, { page, pageSize }),
      countResources(ctx.env.DB),
    ]);
    if (resources.length === 0) {
      await ctx.reply('暂无资源。');
      return;
    }
    const lines = resources.map(
      (resource, index) => `${(page - 1) * pageSize + index + 1}. ${buildResourceBrief(resource)}`,
    );
    await ctx.reply(`资源列表（第 ${page} 页，共 ${total} 条）：\n${lines.join('\n\n')}`);
  });

  bot.chatType('private').command('res_del', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const raw = (ctx.match ?? '').trim();
    if (!raw) {
      await ctx.reply('用法：/res_del <短码|ID>');
      return;
    }
    const resource = await resolveResource(ctx.env.DB, raw);
    if (!resource) {
      await ctx.reply('资源不存在，请检查短码或 ID。');
      return;
    }
    await deleteResource(ctx.env.DB, resource.id);
    await safeWriteAdminLog(
      ctx.env.DB,
      adminId,
      'resource_delete',
      `id=${resource.id} short_code=${resource.short_code} title=${resource.title}`,
    );
    await ctx.reply(`已删除资源 #${resource.sequence}（短码 ${resource.short_code}）。`);
  });

  bot.chatType('private').command('res_price', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const parts = (ctx.match ?? '').trim().split(/\s+/);
    if (parts.length !== 2) {
      await ctx.reply('用法：/res_price <短码|ID> <积分>');
      return;
    }
    const price = Number(parts[1]);
    if (!Number.isInteger(price) || price < 0) {
      await ctx.reply('价格必须是非负整数积分。');
      return;
    }
    const resource = await resolveResource(ctx.env.DB, parts[0]);
    if (!resource) {
      await ctx.reply('资源不存在，请检查短码或 ID。');
      return;
    }
    const updated = await updateResource(ctx.env.DB, resource.id, {
      price,
      isPaid: price > 0,
    });
    await safeWriteAdminLog(
      ctx.env.DB,
      adminId,
      'resource_price',
      `id=${resource.id} short_code=${resource.short_code} price=${price}`,
    );
    await ctx.reply(
      updated
        ? `资源 ${resource.short_code} 已${price > 0 ? `设为付费 ${price} 积分` : '改为免费'}。`
        : '更新失败，请稍后重试。',
    );
  });

  bot.chatType('private').command('res_paid', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const parts = (ctx.match ?? '').trim().split(/\s+/);
    if (parts.length !== 2) {
      await ctx.reply('用法：/res_paid <短码|ID> <on|off>');
      return;
    }
    const enabled = parseBoolean(parts[1]);
    const resource = await resolveResource(ctx.env.DB, parts[0]);
    if (!resource) {
      await ctx.reply('资源不存在，请检查短码或 ID。');
      return;
    }
    if (enabled && resource.price <= 0) {
      await ctx.reply('开启付费前请先使用 /res_price 设置价格。');
      return;
    }
    const updated = await updateResource(ctx.env.DB, resource.id, { isPaid: enabled });
    await safeWriteAdminLog(
      ctx.env.DB,
      adminId,
      'resource_paid',
      `id=${resource.id} short_code=${resource.short_code} is_paid=${enabled ? 1 : 0}`,
    );
    await ctx.reply(updated ? `资源 ${resource.short_code} 付费开关已${enabled ? '开启' : '关闭'}。` : '更新失败，请稍后重试。');
  });

  bot.chatType('private').command('res_set', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const match = /^(\S+)\s+(title|tags)\s+([\s\S]+)$/.exec((ctx.match ?? '').trim());
    if (!match) {
      await ctx.reply('用法：/res_set <短码|ID> title|tags <内容>');
      return;
    }
    const resource = await resolveResource(ctx.env.DB, match[1]);
    if (!resource) {
      await ctx.reply('资源不存在，请检查短码或 ID。');
      return;
    }
    const field = match[2];
    const value =
      field === 'tags'
        ? match[3]
            .split(/[,，\s]+/)
            .map((tag) => tag.trim().replace(/^#/, ''))
            .filter(Boolean)
            .join(',')
        : match[3].trim();
    if (!value) {
      await ctx.reply('内容不能为空。');
      return;
    }
    const updated = await updateResource(ctx.env.DB, resource.id, {
      ...(field === 'title' ? { title: value } : { tags: value }),
    });
    await safeWriteAdminLog(
      ctx.env.DB,
      adminId,
      field === 'title' ? 'resource_title' : 'resource_tags',
      `id=${resource.id} short_code=${resource.short_code} value=${value}`,
    );
    await ctx.reply(
      updated
        ? `资源 ${resource.short_code} 的${field === 'title' ? '标题' : '标签'}已更新。`
        : '更新失败，请稍后重试。',
    );
  });

  bot.chatType('private').command('stats', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    await ctx.reply(await buildStatsText(ctx.env.DB));
  });

  bot.chatType('private').command('logs', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const limit = Math.min(parsePositiveInt(ctx.match, 20), 50);
    const logs = await listAdminLogs(ctx.env.DB, { page: 1, pageSize: limit });
    if (logs.length === 0) {
      await ctx.reply('暂无操作日志。');
      return;
    }
    const lines = logs.map((log) => {
      const detail = log.detail.length > 120 ? `${log.detail.slice(0, 120)}...` : log.detail;
      return `#${log.id} ${formatLocalDateTime(log.created_at)} admin=${log.admin_id} ${log.action}\n${detail}`;
    });
    await ctx.reply(`操作日志（最新 ${logs.length} 条）：\n${lines.join('\n\n')}`);
  });

  // 管理员转发/发送媒体默认自动入库；说明以 /bc 开头时由广播处理器接管。
  bot.chatType('private').on('message:media', async (ctx, next) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const caption = getMessageCaption(ctx.message);
    if (isBroadcastCaptionCommand(caption)) {
      await next();
      return;
    }
    const media = extractMediaFromMessage(ctx.message);
    if (!media) {
      await ctx.reply('未识别到可入库的媒体，请转发图片、视频、文档、音频等。');
      return;
    }
    const meta = parseResourceCaption(caption);
    const shortCode = await generateUniqueShortCode(ctx.env.DB);
    const title = meta.title.trim() || `资源 ${shortCode}`;
    const resource = await createResource(ctx.env.DB, {
      shortCode,
      fileId: media.fileId,
      fileUniqueId: media.fileUniqueId ?? null,
      title,
      tags: meta.tags,
      isPaid: meta.isPaid,
      price: meta.price,
      creatorId: adminId,
    });
    await safeWriteAdminLog(
      ctx.env.DB,
      adminId,
      'resource_create',
      `id=${resource.id} short_code=${resource.short_code} title=${title} tags=${meta.tags} price=${meta.price}`,
    );
    await ctx.reply(buildResourceSavedText(resource));
  });
}
