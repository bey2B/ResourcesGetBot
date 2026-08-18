import { describe, expect, it } from 'vitest';
import { getAvailableAds } from '../src/db/queries';
import { getAdForPosition, pickWeightedAd } from '../src/services/ads';
import type { Ad } from '../src/types';
import { createMemoryDb } from './helpers/d1-mock';

function ad(id: number, weight: number): Ad {
  return {
    id,
    position: 'top',
    content: `ad-${id}`,
    weight,
    enabled: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('ads', () => {
  it('pickWeightedAd 按权重命中，空列表返回 null', () => {
    const ads = [ad(1, 1), ad(2, 1)];
    expect(pickWeightedAd(ads, () => 0)?.id).toBe(1);
    expect(pickWeightedAd(ads, () => 0.9)?.id).toBe(2);
    expect(pickWeightedAd(ads, () => 0.999)?.id).toBe(2);
    expect(pickWeightedAd([], () => 0)).toBeNull();
  });

  it('所有权重为 0 时均匀回退仍返回广告', () => {
    const zero = [ad(1, 0), ad(2, 0)];
    const picked = pickWeightedAd(zero, () => 0.5);
    expect(zero.map((item) => item.id)).toContain(picked?.id);
  });

  it('getAdForPosition 只返回启用广告并按权重轮换', async () => {
    const db = createMemoryDb();
    db.seedAd({ id: 1, position: 'top', content: 'top-a', weight: 2, enabled: 1 });
    db.seedAd({ id: 2, position: 'top', content: 'top-b', weight: 1, enabled: 1 });
    db.seedAd({ id: 3, position: 'top', content: 'top-off', weight: 5, enabled: 0 });
    db.seedAd({ id: 4, position: 'bottom', content: 'bottom-a', weight: 1, enabled: 1 });

    expect((await getAdForPosition(db, 'top', { random: () => 0 }))?.content).toBe('top-a');
    expect((await getAdForPosition(db, 'bottom', { random: () => 0.999 }))?.content).toBe(
      'bottom-a',
    );
    const available = await getAvailableAds(db, 'top');
    expect(available.map((row) => row.id)).toEqual([1, 2]);
  });
});
