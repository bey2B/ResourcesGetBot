import { describe, expect, it } from 'vitest';
import { adjustUserPoints, getUser, upsertUser } from '../src/db/queries';
import {
  dailyCheckIn,
  purchaseResource,
  rewardInvite,
} from '../src/services/points';
import { createMemoryDb } from './helpers/d1-mock';

describe('points', () => {
  it('每日签到 +1，同日重复签到不重复发分', async () => {
    const db = createMemoryDb();
    await upsertUser(db, { userId: 1001, username: 'alice', firstName: 'Alice' });

    const first = await dailyCheckIn(db, 1001);
    expect(first.ok).toBe(true);
    expect(first.balance).toBe(1);

    const again = await dailyCheckIn(db, 1001);
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('already_checked_in');

    const user = await getUser(db, 1001);
    expect(user?.points).toBe(1);
    expect(db.pointsLogs).toHaveLength(1);
  });

  it('邀请新用户 +5，同一好友不重复发放，超过窗口不发', async () => {
    const db = createMemoryDb();
    await upsertUser(db, { userId: 2001, username: 'inviter' });
    await upsertUser(db, { userId: 2002, username: 'newcomer', invitedBy: 2001 });

    const reward = await rewardInvite(db, 2001, 2002);
    expect(reward.ok).toBe(true);
    expect(reward.change).toBe(5);
    expect(reward.balance).toBe(5);

    const duplicate = await rewardInvite(db, 2001, 2002);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.reason).toBe('duplicate_reward');

    await upsertUser(db, { userId: 2003, username: 'late', invitedBy: 2001 });
    const late = await rewardInvite(db, 2001, 2003, {
      now: new Date(Date.now() + 400_000),
    });
    expect(late.ok).toBe(false);
    expect(late.reason).toBe('not_new_user');
  });

  it('付费资源购买扣积分并记录下载，余额不足与免费资源正确拒绝', async () => {
    const db = createMemoryDb();
    await upsertUser(db, { userId: 3001, username: 'buyer' });
    await adjustUserPoints(db, 3001, 10);
    db.seedResource({
      id: 1,
      short_code: 'AAAA1111',
      file_id: 'file-paid',
      is_paid: 1,
      price: 3,
    });
    db.seedResource({
      id: 2,
      short_code: 'BBBB2222',
      file_id: 'file-free',
      is_paid: 0,
      price: 0,
    });

    const purchase = await purchaseResource(db, 3001, 1);
    expect(purchase.ok).toBe(true);
    expect(purchase.balance).toBe(7);
    expect(db.downloads).toHaveLength(1);
    expect(db.resources[0]?.download_count).toBe(1);

    await upsertUser(db, { userId: 3002, username: 'poor' });
    const poor = await purchaseResource(db, 3002, 1);
    expect(poor.ok).toBe(false);
    expect(poor.reason).toBe('insufficient_balance');
    expect(poor.message).toContain('积分不足');

    const free = await purchaseResource(db, 3001, 2);
    expect(free.ok).toBe(false);
    expect(free.reason).toBe('resource_not_paid');
  });
});
