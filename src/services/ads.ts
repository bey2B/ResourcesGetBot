/**
 * 广告服务：按位置读取启用广告，并按 weight 做加权概率轮换。
 */

import { InlineKeyboard } from 'grammy';
import type { Api } from 'grammy';
import { getAdMessage, getAdMessageButtons, getAvailableAds } from '../db/queries';
import type { Ad, AdButton, AdPosition } from '../types';
import { AppError, errorMessage } from '../utils/helpers';

export interface AdServiceOptions {
  random?: () => number;
}

function clampRandom(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 0.999999999999);
}

/** 纯函数加权选择：权重越大命中概率越高；所有权重为 0 时均匀随机。 */
export function pickWeightedAd(ads: readonly Ad[], random: () => number = Math.random): Ad | null {
  if (ads.length === 0) {
    return null;
  }
  const totalWeight = ads.reduce((sum, ad) => sum + Math.max(ad.weight, 0), 0);
  if (totalWeight <= 0) {
    return ads[Math.floor(clampRandom(random) * ads.length)] ?? null;
  }
  let cursor = clampRandom(random) * totalWeight;
  for (const ad of ads) {
    cursor -= Math.max(ad.weight, 0);
    if (cursor <= 0) {
      return ad;
    }
  }
  return ads[ads.length - 1] ?? null;
}

export async function getAdForPosition(
  db: D1Database,
  position: AdPosition,
  options: AdServiceOptions = {},
): Promise<Ad | null> {
  const ads = await getAvailableAds(db, position);
  return pickWeightedAd(ads, options.random);
}

function buildAdKeyboard(buttons: AdButton[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  buttons.forEach((button, index) => {
    if (index > 0) {
      keyboard.row();
    }
    keyboard.url(button.text, button.url);
  });
  return keyboard;
}

function adMediaOptions(
  text: string,
  replyMarkup?: InlineKeyboard,
): { caption?: string; reply_markup?: InlineKeyboard } | undefined {
  if (!text && !replyMarkup) {
    return undefined;
  }
  const options: { caption?: string; reply_markup?: InlineKeyboard } = {};
  if (text) {
    options.caption = text;
  }
  if (replyMarkup) {
    options.reply_markup = replyMarkup;
  }
  return options;
}

async function sendAdMediaByType(
  api: Api,
  chatId: number,
  fileId: string,
  mediaType: string,
  options: { caption?: string; reply_markup?: InlineKeyboard } | undefined,
  replyMarkup?: InlineKeyboard,
): Promise<number | null> {
  switch (mediaType.trim().toLowerCase()) {
    case 'photo':
      return (await api.sendPhoto(chatId, fileId, options)).message_id;
    case 'video':
      return (await api.sendVideo(chatId, fileId, options)).message_id;
    case 'document':
      return (await api.sendDocument(chatId, fileId, options)).message_id;
    case 'audio':
      return (await api.sendAudio(chatId, fileId, options)).message_id;
    case 'animation':
      return (await api.sendAnimation(chatId, fileId, options)).message_id;
    case 'voice':
      return (await api.sendVoice(chatId, fileId, options)).message_id;
    case 'video_note':
      return (
        await api.sendVideoNote(
          chatId,
          fileId,
          replyMarkup ? { reply_markup: replyMarkup } : undefined,
        )
      ).message_id;
    case 'sticker':
      return (
        await api.sendSticker(
          chatId,
          fileId,
          replyMarkup ? { reply_markup: replyMarkup } : undefined,
        )
      ).message_id;
    default:
      return null;
  }
}

/** 发送单条独立广告消息：有媒体走媒体+文字，无媒体只发文字，按钮为空时不带键盘。 */
export async function sendAd(
  api: Api,
  db: D1Database,
  ad: Ad,
  chatId: number,
): Promise<number | null> {
  const message = await getAdMessage(db, ad.id);
  const buttons = message ? await getAdMessageButtons(db, ad.id) : [];
  const replyMarkup = buttons.length > 0 ? buildAdKeyboard(buttons) : undefined;
  const text = (message ? message.text : ad.content).trim();
  const mediaFileId = message?.media_file_id?.trim() ?? '';
  const mediaType = message?.media_type ?? '';
  if (!text && !mediaFileId) {
    return null;
  }
  if (!mediaFileId) {
    return (
      await api.sendMessage(
        chatId,
        text,
        replyMarkup ? { reply_markup: replyMarkup } : undefined,
      )
    ).message_id;
  }
  const options = adMediaOptions(text, replyMarkup);
  try {
    const byType = await sendAdMediaByType(
      api,
      chatId,
      mediaFileId,
      mediaType,
      options,
      replyMarkup,
    );
    if (byType !== null) {
      return byType;
    }
  } catch {
    // 已知类型发送失败时继续兜底尝试。
  }
  const attempts: Array<() => Promise<unknown>> = [
    () => api.sendDocument(chatId, mediaFileId, options),
    () => api.sendPhoto(chatId, mediaFileId, options),
    () => api.sendVideo(chatId, mediaFileId, options),
    () => api.sendAnimation(chatId, mediaFileId, options),
    () => api.sendAudio(chatId, mediaFileId, options),
    () => api.sendVoice(chatId, mediaFileId, options),
    () =>
      api.sendVideoNote(
        chatId,
        mediaFileId,
        replyMarkup ? { reply_markup: replyMarkup } : undefined,
      ),
    () =>
      api.sendSticker(
        chatId,
        mediaFileId,
        replyMarkup ? { reply_markup: replyMarkup } : undefined,
      ),
  ];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const sent = await attempt();
      return (sent as { message_id?: number }).message_id ?? 0;
    } catch (err) {
      lastError = err;
    }
  }
  throw new AppError(`广告媒体发送失败：${errorMessage(lastError)}`);
}

/** 按位置读取启用广告并作为独立消息发送；无可用广告时不发送。 */
export async function sendAdForPosition(
  api: Api,
  db: D1Database,
  chatId: number,
  position: AdPosition,
  options: AdServiceOptions = {},
): Promise<number | null> {
  const ad = await getAdForPosition(db, position, options);
  if (!ad) {
    return null;
  }
  return sendAd(api, db, ad, chatId);
}
