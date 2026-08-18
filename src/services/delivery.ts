/**
 * 合集资源投递服务：按 resource_files 顺序读取全部文件并发送。
 * 支持 single（逐条发送）与 album（photo/video 组成消息块）两种模式，
 * 供短码获取、群组自动回复与后续 /purchases 点击发送复用。
 */

import type { Api } from 'grammy';
import { InputMediaBuilder } from 'grammy';
import { getSetting, listResourceFiles } from '../db/queries';
import type { Resource, ResourceFile } from '../types';
import { AppError, errorMessage } from '../utils/helpers';

export type ResourceSendMode = 'single' | 'album';

export const RESOURCE_SEND_MODE_KEY = 'resource_send_mode';
export const RESOURCE_SEND_MODE_DEFAULT: ResourceSendMode = 'single';
export const ALBUM_MEDIA_MAX = 10;

export interface ResourceDeliveryOptions {
  /** D1，用于读取 resource_files 与缺省发送模式。 */
  db: D1Database;
  /** 显式指定发送模式；未传时读取 settings 的 resource_send_mode，缺省 single。 */
  mode?: ResourceSendMode;
  /** 附加到第一个发送文件的说明文案。 */
  caption?: string;
}

export interface ResourceDeliverySummary {
  messageIds: number[];
  mode: ResourceSendMode;
  fileCount: number;
}

export function parseResourceSendMode(raw: string | null | undefined): ResourceSendMode {
  return raw?.trim().toLowerCase() === 'album' ? 'album' : 'single';
}

export async function getResourceSendMode(db: D1Database): Promise<ResourceSendMode> {
  return parseResourceSendMode(await getSetting(db, RESOURCE_SEND_MODE_KEY));
}

/** 兼容旧资源：resource_files 未写入时从 file_ids / file_id 派生文件列表。 */
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

export async function loadResourceFiles(
  db: D1Database,
  resource: Resource,
): Promise<ResourceFile[]> {
  const rows = await listResourceFiles(db, resource.id);
  if (rows.length > 0) {
    return rows;
  }
  return parseResourceFileIds(resource).map((fileId, index) => ({
    id: 0,
    resource_id: resource.id,
    file_id: fileId,
    file_unique_id: index === 0 ? resource.file_unique_id : null,
    media_type: '',
    sort_order: index,
    created_at: resource.created_at,
  }));
}

function captionOptions(caption?: string): { caption?: string } | undefined {
  return caption ? { caption } : undefined;
}

async function sendByMediaType(
  api: Api,
  chatId: number,
  file: ResourceFile,
  caption?: string,
): Promise<number | null> {
  const options = captionOptions(caption);
  const mediaType = file.media_type.trim().toLowerCase();
  switch (mediaType) {
    case 'photo':
      return (await api.sendPhoto(chatId, file.file_id, options)).message_id;
    case 'video':
      return (await api.sendVideo(chatId, file.file_id, options)).message_id;
    case 'document':
      return (await api.sendDocument(chatId, file.file_id, options)).message_id;
    case 'audio':
      return (await api.sendAudio(chatId, file.file_id, options)).message_id;
    case 'animation':
      return (await api.sendAnimation(chatId, file.file_id, options)).message_id;
    case 'voice':
      return (await api.sendVoice(chatId, file.file_id, options)).message_id;
    case 'video_note':
      return (await api.sendVideoNote(chatId, file.file_id)).message_id;
    case 'sticker':
      return (await api.sendSticker(chatId, file.file_id)).message_id;
    default:
      return null;
  }
}

/** media_type 未知或对应 API 失败时按常见类型逐类尝试，兼容旧数据。 */
async function sendWithFallback(
  api: Api,
  chatId: number,
  file: ResourceFile,
  caption?: string,
): Promise<number> {
  const options = captionOptions(caption);
  const attempts: Array<() => Promise<{ message_id: number }>> = [
    () => api.sendDocument(chatId, file.file_id, options),
    () => api.sendPhoto(chatId, file.file_id, options),
    () => api.sendVideo(chatId, file.file_id, options),
    () => api.sendAnimation(chatId, file.file_id, options),
    () => api.sendAudio(chatId, file.file_id, options),
    () => api.sendVoice(chatId, file.file_id, options),
    () => api.sendVideoNote(chatId, file.file_id),
    () => api.sendSticker(chatId, file.file_id),
  ];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      return (await attempt()).message_id;
    } catch (err) {
      lastError = err;
    }
  }
  throw new AppError(`资源文件发送失败，请稍后重试或联系管理员。（${errorMessage(lastError)}）`);
}

export async function sendSingleFile(
  api: Api,
  chatId: number,
  file: ResourceFile,
  caption?: string,
): Promise<number> {
  try {
    const messageId = await sendByMediaType(api, chatId, file, caption);
    if (messageId !== null) {
      return messageId;
    }
  } catch {
    // 已知类型发送失败时继续走兜底尝试
  }
  return sendWithFallback(api, chatId, file, caption);
}

export async function sendResourceFilesSingle(
  api: Api,
  chatId: number,
  files: readonly ResourceFile[],
  caption?: string,
): Promise<number[]> {
  const messageIds: number[] = [];
  let captionSent = false;
  for (const file of files) {
    messageIds.push(await sendSingleFile(api, chatId, file, captionSent ? undefined : caption));
    captionSent = true;
  }
  return messageIds;
}

function isAlbumMedia(file: ResourceFile): boolean {
  const mediaType = file.media_type.trim().toLowerCase();
  return mediaType === 'photo' || mediaType === 'video';
}

function buildAlbumInput(file: ResourceFile, caption?: string) {
  const options = caption ? { caption } : {};
  return file.media_type.trim().toLowerCase() === 'video'
    ? InputMediaBuilder.video(file.file_id, options)
    : InputMediaBuilder.photo(file.file_id, options);
}

/** album 模式：photo/video 按连续顺序每 10 条一组，其余类型逐条发送。 */
export async function sendResourceFilesInAlbumMode(
  api: Api,
  chatId: number,
  files: readonly ResourceFile[],
  caption?: string,
): Promise<number[]> {
  const messageIds: number[] = [];
  let pending: ResourceFile[] = [];
  let captionSent = false;

  const flushPending = async (): Promise<void> => {
    if (pending.length === 0) {
      return;
    }
    const batch = pending;
    pending = [];
    if (batch.length === 1) {
      messageIds.push(await sendSingleFile(api, chatId, batch[0], captionSent ? undefined : caption));
      captionSent = true;
      return;
    }
    const firstCaption = captionSent ? undefined : caption;
    const media = batch.map((file, index) =>
      buildAlbumInput(file, index === 0 ? firstCaption : undefined),
    );
    try {
      const messages = await api.sendMediaGroup(chatId, media);
      messageIds.push(...messages.map((message) => message.message_id));
    } catch {
      // 媒体组发送失败时逐条退回，避免整个资源中断
      for (const file of batch) {
        messageIds.push(await sendSingleFile(api, chatId, file, captionSent ? undefined : caption));
        captionSent = true;
      }
      return;
    }
    captionSent = true;
  };

  for (const file of files) {
    if (isAlbumMedia(file)) {
      pending.push(file);
      if (pending.length >= ALBUM_MEDIA_MAX) {
        await flushPending();
      }
    } else {
      await flushPending();
      messageIds.push(await sendSingleFile(api, chatId, file, captionSent ? undefined : caption));
      captionSent = true;
    }
  }
  await flushPending();
  return messageIds;
}

export async function deliverResource(
  api: Api,
  chatId: number,
  resource: Resource,
  options: ResourceDeliveryOptions,
): Promise<ResourceDeliverySummary> {
  const files = await loadResourceFiles(options.db, resource);
  if (files.length === 0) {
    throw new AppError('资源文件缺失，请稍后重试或联系管理员', 500, 'RESOURCE_FILE_MISSING');
  }
  const mode = options.mode ?? (await getResourceSendMode(options.db));
  const messageIds =
    mode === 'album'
      ? await sendResourceFilesInAlbumMode(api, chatId, files, options.caption)
      : await sendResourceFilesSingle(api, chatId, files, options.caption);
  return { messageIds, mode, fileCount: files.length };
}
