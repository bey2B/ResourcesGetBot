/**
 * 强制关注频道验证服务。
 * 从 settings 读取开关与频道列表（@username 或 channel id 的 JSON 数组），
 * 通过 Telegram Bot API getChatMember 校验用户是否已加入每个频道。
 */

import { getSettings } from '../db/queries';
import { parseBoolean, parseUniqueCsv } from '../utils/helpers';

export const SUBSCRIPTION_ENABLED_KEY = 'force_subscribe_enabled';
export const SUBSCRIPTION_CHANNELS_KEY = 'sub_channels';
export const SUBSCRIPTION_INVITE_LINKS_KEY = 'sub_channel_invite_links';
export const TELEGRAM_API_BASE = 'https://api.telegram.org';
export const TELEGRAM_REQUEST_TIMEOUT_MS = 10_000;

export type SubscriptionChannelStatus = 'member' | 'not_member' | 'error';
export type SubscriptionStatus = 'disabled' | 'passed' | 'not_joined' | 'config_missing' | 'api_error';

export interface SubscriptionChannelResult {
  channel: string;
  display: string;
  status: SubscriptionChannelStatus;
  error?: string;
  inviteUrl?: string;
}

export interface SubscriptionCheckResult {
  ok: boolean;
  status: SubscriptionStatus;
  message: string;
  channels: SubscriptionChannelResult[];
  missingChannels: string[];
}

export interface ForceSubscribeSettings {
  enabled: boolean;
  channels: string[];
  inviteLinks: Record<string, string>;
}

export type TelegramMemberFetchResult =
  | { ok: true; status: string; isMember?: boolean }
  | { ok: false; description: string };

export type TelegramMemberFetcher = (
  botToken: string,
  chatId: string,
  userId: number,
) => Promise<TelegramMemberFetchResult>;

export interface CheckForceSubscribeOptions {
  botToken: string;
  fetcher?: TelegramMemberFetcher;
}

const MEMBER_STATUSES = new Set(['creator', 'administrator', 'member']);

function isMember(status: string, isMemberFlag?: boolean): boolean {
  if (MEMBER_STATUSES.has(status)) {
    return true;
  }
  // restricted 成员是否可访问内容取决于 is_member 标记
  return status === 'restricted' && isMemberFlag !== false;
}

/** 统一频道标识：数字 ID 原样保留，用户名统一补 @ 前缀。 */
export function normalizeChannel(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return trimmed;
  }
  const username = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  return /^@[A-Za-z0-9_]{3,32}$/.test(username) ? username : null;
}

export function parseSubChannels(raw: string | null | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  const trimmed = raw.trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // 非 JSON 时兼容逗号分隔写法
  }
  const candidates = Array.isArray(parsed)
    ? parsed.map((item) => String(item))
    : parseUniqueCsv(trimmed);
  const channels = candidates
    .map((item) => normalizeChannel(item))
    .filter((item): item is string => item !== null);
  return [...new Set(channels)];
}

export function getChannelDisplay(channel: string): string {
  return /^-?\d+$/.test(channel) ? `频道 ${channel}` : channel;
}

async function fetchTelegramMember(
  botToken: string,
  chatId: string,
  userId: number,
): Promise<TelegramMemberFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_REQUEST_TIMEOUT_MS);
  try {
    const url = new URL(`/bot${botToken}/getChatMember`, TELEGRAM_API_BASE);
    url.searchParams.set('chat_id', chatId);
    url.searchParams.set('user_id', String(userId));
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, description: `Telegram API HTTP ${response.status}` };
    }
    const data = (await response.json()) as {
      ok?: boolean;
      description?: string;
      result?: { status?: string; is_member?: boolean };
    };
    if (data.ok !== true) {
      return { ok: false, description: data.description ?? 'Telegram API 返回未知错误' };
    }
    return { ok: true, status: data.result?.status ?? 'left', isMember: data.result?.is_member };
  } catch (err) {
    return { ok: false, description: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function getForceSubscribeSettings(db: D1Database): Promise<ForceSubscribeSettings> {
  const settings = await getSettings(db, [
    SUBSCRIPTION_ENABLED_KEY,
    SUBSCRIPTION_CHANNELS_KEY,
    SUBSCRIPTION_INVITE_LINKS_KEY,
  ]);
  let inviteLinks: Record<string, string> = {};
  try {
    const parsed = JSON.parse(settings[SUBSCRIPTION_INVITE_LINKS_KEY] || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      inviteLinks = parsed as Record<string, string>;
    }
  } catch {
    // 非 JSON 格式时静默忽略，兼容旧数据。
  }
  return {
    enabled: parseBoolean(settings[SUBSCRIPTION_ENABLED_KEY], false),
    channels: parseSubChannels(settings[SUBSCRIPTION_CHANNELS_KEY]),
    inviteLinks,
  };
}

export async function verifyChannelMembership(
  botToken: string,
  channel: string,
  userId: number,
  fetcher: TelegramMemberFetcher = fetchTelegramMember,
): Promise<SubscriptionChannelResult> {
  const display = getChannelDisplay(channel);
  const result = await fetcher(botToken, channel, userId);
  if (!result.ok) {
    return { channel, display, status: 'error', error: result.description };
  }
  return {
    channel,
    display,
    status: isMember(result.status, result.isMember) ? 'member' : 'not_member',
  };
}

function buildNotJoinedMessage(channels: string[]): string {
  const list = channels.map((channel) => `- ${getChannelDisplay(channel)}`).join('\n');
  return `请先关注以下频道后再获取资源：\n${list}\n\n关注完成后请重新点击资源链接。`;
}

export async function checkForceSubscribe(
  db: D1Database,
  userId: number,
  options: CheckForceSubscribeOptions,
): Promise<SubscriptionCheckResult> {
  const settings = await getForceSubscribeSettings(db);
  if (!settings.enabled) {
    return {
      ok: true,
      status: 'disabled',
      message: '未开启强制关注',
      channels: [],
      missingChannels: [],
    };
  }
  if (settings.channels.length === 0) {
    return {
      ok: false,
      status: 'config_missing',
      message: '强制关注已开启，但管理员尚未绑定频道，请联系管理员配置 sub_channels。',
      channels: [],
      missingChannels: [],
    };
  }
  const channels = (await Promise.all(
    settings.channels.map((channel) =>
      verifyChannelMembership(options.botToken, channel, userId, options.fetcher),
    ),
  )).map((ch) => ({ ...ch, inviteUrl: settings.inviteLinks[ch.channel] }));
  const missingChannels = channels
    .filter((channel) => channel.status === 'not_member')
    .map((channel) => channel.display);
  const errored = channels.filter((channel) => channel.status === 'error');
  if (errored.length > 0) {
    return {
      ok: false,
      status: 'api_error',
      message:
        '订阅验证暂时不可用，请稍后重试；若持续失败，请确认机器人是各绑定频道的管理员。',
      channels,
      missingChannels,
    };
  }
  if (missingChannels.length > 0) {
    return {
      ok: false,
      status: 'not_joined',
      message: buildNotJoinedMessage(missingChannels),
      channels,
      missingChannels,
    };
  }
  return {
    ok: true,
    status: 'passed',
    message: '关注验证通过',
    channels,
    missingChannels: [],
  };
}
