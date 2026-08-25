/**
 * 积分服务：每日签到、邀请奖励、付费资源购买。
 * 所有余额变更都会写入 points_logs，保证可追溯。
 */
import {
  addPointsLog,
  adjustUserPoints,
  checkIn,
  createPurchase,
  getUser,
  getUserPurchasedResources,
  getUserStats,
  getResourceById,
  getSetting,
  hasCheckedIn,
  listPointsLogs,
  recordDownload,
} from '../db/queries';
import { AppError, todayInZone, utcToday } from '../utils/helpers';
import type { PointsLog, Resource, UserStats } from '../types';

export const DAILY_CHECKIN_POINTS = 1;
export const INVITE_REWARD_POINTS = 5;
export const CHECKIN_REASON = 'daily_checkin';
export const INVITE_REASON = 'invite_reward';
export const PURCHASE_REASON = 'resource_purchase';
export const INVITE_REWARD_WINDOW_KEY = 'invite_reward_window_seconds';
export const DEFAULT_INVITE_REWARD_WINDOW_SECONDS = 300;

export type PointsFailureReason =
  | 'user_not_found'
  | 'banned'
  | 'already_checked_in'
  | 'inviter_not_found'
  | 'self_invite'
  | 'invalid_invite'
  | 'not_new_user'
  | 'duplicate_reward'
  | 'resource_not_found'
  | 'resource_not_paid'
  | 'insufficient_balance';

export interface PointsOperationResult {
  ok: boolean;
  reason: string;
  message: string;
  balance: number | null;
  change: number;
}

export interface CheckinStatusResult {
  ok: boolean;
  reason: string;
  message: string;
  checkedIn: boolean;
  date: string;
  balance: number | null;
}

export interface RewardInviteOptions {
  now?: Date;
  windowSeconds?: number;
}

function okResult(message: string, balance: number | null, change: number): PointsOperationResult {
  return { ok: true, reason: 'success', message, balance, change };
}

function failResult(
  reason: PointsFailureReason,
  message: string,
  balance: number | null = null,
  change = 0,
): PointsOperationResult {
  return { ok: false, reason, message, balance, change };
}

function validateUserId(userId: number): void {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AppError('用户 ID 必须是正整数', 400, 'VALIDATION_ERROR');
  }
}

export async function getPointsBalance(
  db: D1Database,
  userId: number,
): Promise<PointsOperationResult> {
  validateUserId(userId);
  const user = await getUser(db, userId);
  if (!user) {
    return failResult('user_not_found', '用户不存在，请先发送 /start 注册。');
  }
  return okResult(`当前积分：${user.points}`, user.points, 0);
}

export async function getCheckinStatus(
  db: D1Database,
  userId: number,
  date = todayInZone(),
): Promise<CheckinStatusResult> {
  validateUserId(userId);
  const user = await getUser(db, userId);
  if (!user) {
    return {
      ok: false,
      reason: 'user_not_found',
      message: '用户不存在，请先发送 /start 注册。',
      checkedIn: false,
      date,
      balance: null,
    };
  }
  const checkedIn = await hasCheckedIn(db, userId, date);
  return {
    ok: true,
    reason: 'success',
    message: checkedIn ? '今天已经签到过了，明天再来吧。' : '今日尚未签到，发送"签到"即可获取积分。',
    checkedIn,
    date,
    balance: user.points,
  };
}

export async function dailyCheckIn(
  db: D1Database,
  userId: number,
  date = todayInZone(),
): Promise<PointsOperationResult> {
  validateUserId(userId);
  const user = await getUser(db, userId);
  if (!user) {
    return failResult('user_not_found', '用户不存在，请先发送 /start 注册。');
  }
  if (user.is_banned) {
    return failResult('banned', '账号已被封禁，无法签到。', user.points);
  }
  if (await hasCheckedIn(db, userId, date)) {
    return failResult('already_checked_in', '今天已经签到过了，明天再来吧。', user.points);
  }
  // INSERT OR IGNORE 保证同日去重，只有真正插入成功的那次才发放积分
  const inserted = await checkIn(db, userId, date);
  if (!inserted) {
    return failResult('already_checked_in', '今天已经签到过了，明天再来吧。', user.points);
  }
  const balance = await adjustUserPoints(db, userId, DAILY_CHECKIN_POINTS);
  if (balance === null) {
    return failResult('user_not_found', '用户不存在，请先发送 /start 注册。');
  }
  await addPointsLog(db, {
    userId,
    change: DAILY_CHECKIN_POINTS,
    balanceAfter: balance,
    reason: CHECKIN_REASON,
  });
  return okResult(`签到成功，积分 +${DAILY_CHECKIN_POINTS}`, balance, DAILY_CHECKIN_POINTS);
}

export async function getInviteRewardWindowSeconds(
  db: D1Database,
  windowSeconds?: number,
): Promise<number> {
  if (windowSeconds !== undefined) {
    if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
      throw new AppError('邀请奖励窗口必须是正整数秒', 400, 'VALIDATION_ERROR');
    }
    return windowSeconds;
  }
  const raw = await getSetting(db, INVITE_REWARD_WINDOW_KEY);
  const parsed = Number(raw ?? '');
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_INVITE_REWARD_WINDOW_SECONDS;
}

/** 邀请好友成功奖励：仅限 start=inv_xxx 的新用户，同一对好友只发放一次。 */
export async function rewardInvite(
  db: D1Database,
  inviterId: number,
  newUserId: number,
  options: RewardInviteOptions = {},
): Promise<PointsOperationResult> {
  validateUserId(inviterId);
  validateUserId(newUserId);
  if (inviterId === newUserId) {
    return failResult('self_invite', '不能通过自己的邀请链接获得积分。');
  }
  const inviter = await getUser(db, inviterId);
  if (!inviter) {
    return failResult('inviter_not_found', '邀请人不存在，无法发放邀请奖励。');
  }
  if (inviter.is_banned) {
    return failResult('banned', '邀请人已被封禁，无法发放奖励。', inviter.points);
  }
  const newUser = await getUser(db, newUserId);
  if (!newUser) {
    return failResult('user_not_found', '新用户尚未注册，请先发送 /start。');
  }
  if (newUser.invited_by !== inviterId) {
    return failResult('invalid_invite', '邀请关系不存在或已失效。');
  }
  const now = options.now ?? new Date();
  const windowSeconds = await getInviteRewardWindowSeconds(db, options.windowSeconds);
  const createdAt = Date.parse(newUser.created_at);
  if (Number.isNaN(createdAt) || now.getTime() - createdAt > windowSeconds * 1000) {
    return failResult('not_new_user', '邀请奖励仅对首次使用的新用户有效。');
  }
  const logs = await listPointsLogs(db, { userId: inviterId, pageSize: 50 });
  const alreadyRewarded = logs.some(
    (log) => log.reason === INVITE_REASON && log.related_id === newUserId,
  );
  if (alreadyRewarded) {
    return failResult('duplicate_reward', '该好友的邀请奖励已发放。', inviter.points);
  }
  const balance = await adjustUserPoints(db, inviterId, INVITE_REWARD_POINTS);
  if (balance === null) {
    return failResult('inviter_not_found', '邀请人不存在，无法发放邀请奖励。');
  }
  await addPointsLog(db, {
    userId: inviterId,
    change: INVITE_REWARD_POINTS,
    balanceAfter: balance,
    reason: INVITE_REASON,
    relatedId: newUserId,
  });
  return okResult(
    `邀请成功，积分 +${INVITE_REWARD_POINTS}`,
    balance,
    INVITE_REWARD_POINTS,
  );
}

export async function purchaseResource(
  db: D1Database,
  userId: number,
  resourceId: number,
): Promise<PointsOperationResult> {
  validateUserId(userId);
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    throw new AppError('资源 ID 必须是正整数', 400, 'VALIDATION_ERROR');
  }
  const user = await getUser(db, userId);
  if (!user) {
    return failResult('user_not_found', '用户不存在，请先发送 /start 注册。', user?.points ?? null);
  }
  if (user.is_banned) {
    return failResult('banned', '账号已被封禁，无法购买资源。', user.points);
  }
  const resource = await getResourceById(db, resourceId);
  if (!resource) {
    return failResult('resource_not_found', '资源不存在或已下架。', user.points);
  }
  if (resource.is_paid !== 1 || resource.price <= 0) {
    return failResult('resource_not_paid', '该资源为免费资源，无需积分购买。', user.points);
  }
  if (user.points < resource.price) {
    return failResult(
      'insufficient_balance',
      `积分不足：当前 ${user.points} 积分，需要 ${resource.price} 积分。可通过每日签到（+1）或邀请好友（+5）获取积分。`,
      user.points,
    );
  }
  const balance = await adjustUserPoints(db, userId, -resource.price);
  if (balance === null) {
    return failResult('user_not_found', '用户不存在，请先发送 /start 注册。');
  }
  // 并发兜底：若扣款后余额为负则回滚，保证余额永不为负
  if (balance < 0) {
    await adjustUserPoints(db, userId, resource.price);
    return failResult(
      'insufficient_balance',
      `积分不足：当前 ${user.points} 积分，需要 ${resource.price} 积分。可通过每日签到（+1）或邀请好友（+5）获取积分。`,
      user.points,
    );
  }
  await addPointsLog(db, {
    userId,
    change: -resource.price,
    balanceAfter: balance,
    reason: PURCHASE_REASON,
    relatedId: resource.id,
  });
  await recordDownload(db, userId, resource.id);
  await createPurchase(db, { userId, resourceId, price: resource.price });
  return okResult(`购买成功，已扣除 ${resource.price} 积分`, balance, -resource.price);
}

export async function getPurchaseRecords(db: D1Database, userId: number): Promise<Resource[]> {
  validateUserId(userId);
  return getUserPurchasedResources(db, userId);
}

export async function getPointsLogs(
  db: D1Database,
  userId: number,
  page = 1,
  pageSize = 50,
): Promise<PointsLog[]> {
  validateUserId(userId);
  return listPointsLogs(db, { userId, page, pageSize });
}

export async function getUserPointsStats(
  db: D1Database,
  userId: number,
): Promise<UserStats | null> {
  validateUserId(userId);
  return getUserStats(db, userId);
}
