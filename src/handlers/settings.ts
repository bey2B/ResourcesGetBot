/**
 * 系统设置命令：查看/修改 settings 表，并维护上方/下方广告位。
 */

import type { Bot } from 'grammy';
import {
  createAd,
  deleteAd,
  getSettings,
  listAds,
  setSetting,
  updateAd,
  type AdRow,
} from '../db/queries';
import {
  INVITE_REWARD_WINDOW_KEY,
} from '../services/points';
import { RATE_LIMIT_SECONDS_KEY } from '../services/rate-limit';
import {
  SUBSCRIPTION_CHANNELS_KEY,
  SUBSCRIPTION_ENABLED_KEY,
  parseSubChannels,
} from '../services/subscription';
import { isAdminUserId } from '../utils/auth';
import { parseBoolean } from '../utils/helpers';
import type { Ad, AdPosition } from '../types';
import type { BotContext } from '../bot';
import { GROUP_AUTO_DELETE_SECONDS_KEY, GROUP_REPLY_ENABLED_KEY } from './group';
import { MESSAGE_BLOCK_ENABLED_KEY } from './resource';
import { safeWriteAdminLog } from './broadcast';

const BOOLEAN_SETTING_KEYS = new Set([
  SUBSCRIPTION_ENABLED_KEY,
  GROUP_REPLY_ENABLED_KEY,
  MESSAGE_BLOCK_ENABLED_KEY,
]);
const POSITIVE_NUMBER_KEYS = new Set([RATE_LIMIT_SECONDS_KEY, INVITE_REWARD_WINDOW_KEY]);
const NON_NEGATIVE_NUMBER_KEYS = new Set([GROUP_AUTO_DELETE_SECONDS_KEY]);
const CHANNEL_KEYS = new Set([SUBSCRIPTION_CHANNELS_KEY]);

const ALLOWED_KEYS = [
  SUBSCRIPTION_ENABLED_KEY,
  SUBSCRIPTION_CHANNELS_KEY,
  GROUP_REPLY_ENABLED_KEY,
  GROUP_AUTO_DELETE_SECONDS_KEY,
  RATE_LIMIT_SECONDS_KEY,
  MESSAGE_BLOCK_ENABLED_KEY,
  INVITE_REWARD_WINDOW_KEY,
];

export interface SettingsSnapshot {
  forceSubscribeEnabled: boolean;
  channels: string[];
  groupReplyEnabled: boolean;
  groupAutoDeleteSeconds: number;
  rateLimitSeconds: number;
  messageBlockEnabled: boolean;
  inviteRewardWindowSeconds: number;
  ads: Ad[];
}

function toNonNegativeInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw ?? '');
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function readSettingsSnapshot(db: D1Database): Promise<SettingsSnapshot> {
  const [settings, ads] = await Promise.all([
    getSettings(db),
    listAds(db, { page: 1, pageSize: 200 }),
  ]);
  return {
    forceSubscribeEnabled: parseBoolean(settings[SUBSCRIPTION_ENABLED_KEY], false),
    channels: parseSubChannels(settings[SUBSCRIPTION_CHANNELS_KEY]),
    groupReplyEnabled: parseBoolean(settings[GROUP_REPLY_ENABLED_KEY], true),
    groupAutoDeleteSeconds: toNonNegativeInt(
      settings[GROUP_AUTO_DELETE_SECONDS_KEY],
      0,
    ),
    rateLimitSeconds: toNonNegativeInt(settings[RATE_LIMIT_SECONDS_KEY], 30),
    messageBlockEnabled: parseBoolean(settings[MESSAGE_BLOCK_ENABLED_KEY], false),
    inviteRewardWindowSeconds: toNonNegativeInt(
      settings[INVITE_REWARD_WINDOW_KEY],
      300,
    ),
    ads,
  };
}

export type SettingNormalizeResult =
  | { ok: true; value: string }
  | { ok: false; message: string };

/** 校验并规范化 settings 值：开关统一存 1/0，频道列表存 JSON 数组。 */
export function normalizeSettingValue(key: string, raw: string): SettingNormalizeResult {
  const trimmed = raw.trim();
  if (BOOLEAN_SETTING_KEYS.has(key)) {
    const normalized = trimmed.toLowerCase();
    if (['1', '0', 'true', 'false', 'on', 'off', 'yes', 'no', '开', '关'].includes(normalized)) {
      return {
        ok: true,
        value: ['1', 'true', 'on', 'yes', '开'].includes(normalized) ? '1' : '0',
      };
    }
    return { ok: false, message: '开关值只能为 on/off/1/0' };
  }
  if (POSITIVE_NUMBER_KEYS.has(key) || NON_NEGATIVE_NUMBER_KEYS.has(key)) {
    if (!/^\d+$/.test(trimmed)) {
      return { ok: false, message: '请输入非负整数秒数' };
    }
    const value = Number(trimmed);
    if (POSITIVE_NUMBER_KEYS.has(key) && value <= 0) {
      return { ok: false, message: '该设置必须大于 0' };
    }
    return { ok: true, value: String(value) };
  }
  if (CHANNEL_KEYS.has(key)) {
    const channels = parseSubChannels(trimmed);
    if (channels.length === 0) {
      return { ok: false, message: '频道列表为空或格式无效，请用 @用户名 或数字频道 ID（逗号分隔）' };
    }
    return { ok: true, value: JSON.stringify(channels) };
  }
  return { ok: false, message: `未知设置项：${key}（可用：${ALLOWED_KEYS.join(', ')}）` };
}

async function requireAdmin(ctx: BotContext): Promise<number | null> {
  const from = ctx.from;
  if (!from || !isAdminUserId({ ADMIN_IDS: ctx.env.ADMIN_IDS }, from.id)) {
    await ctx.reply('无权限：仅管理员可使用该功能。');
    return null;
  }
  return from.id;
}

function formatChannels(channels: string[]): string {
  return channels.length > 0 ? channels.join('、') : '未配置';
}

function buildSettingsText(snapshot: SettingsSnapshot): string {
  const topCount = snapshot.ads.filter((ad) => ad.position === 'top').length;
  const bottomCount = snapshot.ads.filter((ad) => ad.position === 'bottom').length;
  return [
    '当前系统设置',
    `强制关注：${snapshot.forceSubscribeEnabled ? '开启' : '关闭'}`,
    `关注频道：${formatChannels(snapshot.channels)}`,
    `群组自动回复：${snapshot.groupReplyEnabled ? '开启' : '关闭'}`,
    `群组自动删除秒数：${snapshot.groupAutoDeleteSeconds}`,
    `风控限流秒数：${snapshot.rateLimitSeconds}`,
    `一个文件一个消息块：${snapshot.messageBlockEnabled ? '开启' : '关闭'}`,
    `邀请奖励窗口：${snapshot.inviteRewardWindowSeconds} 秒`,
    `广告：上方 ${topCount} 条 / 下方 ${bottomCount} 条`,
  ].join('\n');
}

async function applySetting(
  ctx: BotContext,
  adminId: number,
  key: string,
  rawValue: string,
): Promise<void> {
  const normalized = normalizeSettingValue(key, rawValue);
  if (!normalized.ok) {
    await ctx.reply(normalized.message);
    return;
  }
  await setSetting(ctx.env.DB, key, normalized.value);
  await safeWriteAdminLog(
    ctx.env.DB,
    adminId,
    'settings_update',
    `${key}=${normalized.value}`,
  );
  await ctx.reply(`设置已更新：${key} = ${normalized.value}`);
}

function buildAdListText(ads: AdRow[]): string {
  if (ads.length === 0) {
    return '暂无广告，使用 /ad_add <top|bottom> <内容> 添加。';
  }
  const lines = ads.map((ad) => {
    const position = ad.position === 'top' ? '上方' : '下方';
    const status = ad.enabled === 1 ? '启用' : '停用';
    const content = ad.content.length > 40 ? `${ad.content.slice(0, 40)}...` : ad.content;
    return `#${ad.id} ${position}｜${status}｜权重 ${ad.weight}\n${content}`;
  });
  return `广告列表（共 ${ads.length} 条）：\n${lines.join('\n\n')}`;
}

export function registerSettingsHandlers(bot: Bot<BotContext>): void {
  bot.chatType('private').command('settings', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const snapshot = await readSettingsSnapshot(ctx.env.DB);
    await ctx.reply(buildSettingsText(snapshot));
  });

  bot.chatType('private').command('set', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const match = /^(\S+)\s+([\s\S]+)$/.exec((ctx.match ?? '').trim());
    if (!match) {
      await ctx.reply(`用法：/set <键名> <值>\n可用键：${ALLOWED_KEYS.join(', ')}`);
      return;
    }
    await applySetting(ctx, adminId, match[1], match[2]);
  });

  bot.chatType('private').command('set_follow', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    await applySetting(ctx, adminId, SUBSCRIPTION_ENABLED_KEY, (ctx.match ?? '').trim());
  });

  bot.chatType('private').command('set_channels', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    await applySetting(ctx, adminId, SUBSCRIPTION_CHANNELS_KEY, (ctx.match ?? '').trim());
  });

  bot.chatType('private').command('set_group', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    await applySetting(ctx, adminId, GROUP_REPLY_ENABLED_KEY, (ctx.match ?? '').trim());
  });

  bot.chatType('private').command('set_auto_del', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    await applySetting(ctx, adminId, GROUP_AUTO_DELETE_SECONDS_KEY, (ctx.match ?? '').trim());
  });

  bot.chatType('private').command('set_rate', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    await applySetting(ctx, adminId, RATE_LIMIT_SECONDS_KEY, (ctx.match ?? '').trim());
  });

  bot.chatType('private').command('set_block', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    await applySetting(ctx, adminId, MESSAGE_BLOCK_ENABLED_KEY, (ctx.match ?? '').trim());
  });

  bot.chatType('private').command('ad_list', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const ads = await listAds(ctx.env.DB, { page: 1, pageSize: 200 });
    await ctx.reply(buildAdListText(ads));
  });

  bot.chatType('private').command('ad_add', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const match = /^(top|bottom)\s+([\s\S]+)$/i.exec((ctx.match ?? '').trim());
    if (!match) {
      await ctx.reply('用法：/ad_add <top|bottom> <广告内容>');
      return;
    }
    const position = match[1].toLowerCase() as AdPosition;
    const content = match[2].trim();
    const ad = await createAd(ctx.env.DB, {
      position,
      content,
      weight: 1,
      enabled: true,
    });
    await safeWriteAdminLog(
      ctx.env.DB,
      adminId,
      'ad_create',
      `id=${ad.id} position=${position}`,
    );
    await ctx.reply(`广告 #${ad.id} 已添加（${position === 'top' ? '上方' : '下方'}，权重 1）。`);
  });

  bot.chatType('private').command('ad_del', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const id = Number((ctx.match ?? '').trim());
    if (!Number.isInteger(id) || id <= 0) {
      await ctx.reply('用法：/ad_del <ID>');
      return;
    }
    const deleted = await deleteAd(ctx.env.DB, id);
    if (!deleted) {
      await ctx.reply('广告不存在。');
      return;
    }
    await safeWriteAdminLog(ctx.env.DB, adminId, 'ad_delete', `id=${id}`);
    await ctx.reply(`广告 #${id} 已删除。`);
  });

  bot.chatType('private').command('ad_weight', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const parts = (ctx.match ?? '').trim().split(/\s+/);
    if (parts.length !== 2) {
      await ctx.reply('用法：/ad_weight <ID> <权重>');
      return;
    }
    const id = Number(parts[0]);
    const weight = Number(parts[1]);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(weight) || weight < 0) {
      await ctx.reply('ID 与权重必须是非负整数。');
      return;
    }
    const updated = await updateAd(ctx.env.DB, id, { weight });
    if (!updated) {
      await ctx.reply('广告不存在。');
      return;
    }
    await safeWriteAdminLog(ctx.env.DB, adminId, 'ad_weight', `id=${id} weight=${weight}`);
    await ctx.reply(`广告 #${id} 权重已设为 ${weight}。`);
  });

  bot.chatType('private').command('ad_toggle', async (ctx) => {
    const adminId = await requireAdmin(ctx);
    if (adminId === null) {
      return;
    }
    const parts = (ctx.match ?? '').trim().split(/\s+/);
    if (parts.length !== 2) {
      await ctx.reply('用法：/ad_toggle <ID> <on|off>');
      return;
    }
    const id = Number(parts[0]);
    const enabled = parseBoolean(parts[1]);
    if (!Number.isInteger(id) || id <= 0) {
      await ctx.reply('广告 ID 无效。');
      return;
    }
    const updated = await updateAd(ctx.env.DB, id, { enabled });
    if (!updated) {
      await ctx.reply('广告不存在。');
      return;
    }
    await safeWriteAdminLog(ctx.env.DB, adminId, 'ad_toggle', `id=${id} enabled=${enabled ? 1 : 0}`);
    await ctx.reply(`广告 #${id} 已${enabled ? '启用' : '停用'}。`);
  });
}
