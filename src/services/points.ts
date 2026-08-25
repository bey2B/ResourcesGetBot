/**
 * 积分服务：签到、积分流水、资源购买（含 purchases 表写入）。
 * 签到日期按 Asia/Shanghai 计算，避免 UTC 偏移导致凌晨签到算前一天。
 */

import {
  createPurchase,
  createPointsLog,
  getCheckinByDate,
  getResourceById,
  getUserById,
  hasDownloaded,
  hasPurchased,
  recordDownload,
  updateUserPoints,
} from '../db/queries';
import { AppError } from '../utils/helpers';
import { todayInZone } from '../utils/helpers';

const DAILY_CHECKIN_POINTS = 10;

export async function dailyCheckIn(
  db: D1Database,
  userId: number,
): Promise<{ points: number; total: number; alreadyCheckedIn: boolean }> {
  const today = todayInZone();
  const existing = await getCheckinByDate(db, userId, today);
  if (existing) {
    const user = await getUserById(db, userId);
    return { points: 0, total: user?.points ?? 0, alreadyCheckedIn: true };
  }
  await createPointsLog(db, {
    userId,
    change: DAILY_CHECKIN_POINTS,
    reason: 'daily_checkin',
    detail: `签到 ${today}`,
  });
  const updated = await updateUserPoints(db, userId, DAILY_CHECKIN_POINTS);
  return {
    points: DAILY_CHECKIN_POINTS,
    total: updated.points,
    alreadyCheckedIn: false,
  };
}

export async function getCheckinStatus(
  db: D1Database,
  userId: number,
): Promise<{ checkedInToday: boolean; today: string }> {
  const today = todayInZone();
  const existing = await getCheckinByDate(db, userId, today);
  return { checkedInToday: !!existing, today };
}

export async function purchaseResource(
  db: D1Database,
  userId: number,
  resourceId: number,
): Promise<{ price: number; remaining: number }> {
  const resource = await getResourceById(db, resourceId);
  if (!resource) {
    throw new AppError('资源不存在', 404, 'RESOURCE_NOT_FOUND');
  }
  if (!resource.is_paid || resource.price <= 0) {
    throw new AppError('该资源为免费资源，无需购买', 400, 'FREE_RESOURCE');
  }
  if (await hasPurchased(db, userId, resourceId)) {
    const user = await getUserById(db, userId);
    return { price: 0, remaining: user?.points ?? 0 };
  }
  const user = await getUserById(db, userId);
  if (!user) {
    throw new AppError('用户不存在', 404, 'USER_NOT_FOUND');
  }
  if (user.points < resource.price) {
    throw new AppError(
      `积分不足，需要 ${resource.price}，当前 ${user.points}`,
      400,
      'INSUFFICIENT_POINTS',
    );
  }
  await createPointsLog(db, {
    userId,
    change: -resource.price,
    reason: 'purchase',
    detail: `购买资源 #${resourceId}`,
  });
  const updated = await updateUserPoints(db, userId, -resource.price);
  if (!(await hasDownloaded(db, userId, resourceId))) {
    await recordDownload(db, { userId, resourceId, source: 'purchase' });
  }
  await createPurchase(db, { userId, resourceId, price: resource.price });
  return { price: resource.price, remaining: updated.points };
}
