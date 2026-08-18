/**
 * 广告服务：按位置读取启用广告，并按 weight 做加权概率轮换。
 */

import { getAvailableAds } from '../db/queries';
import type { Ad, AdPosition } from '../types';

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
