import { describe, expect, it } from 'vitest';
import { upsertUser } from '../src/db/queries';
import {
  checkRateLimit,
  consumeRateLimit,
} from '../src/services/rate-limit';
import { createMemoryDb } from './helpers/d1-mock';

describe('rate-limit', () => {
  it('窗口内重复请求被限流，窗口过期后恢复', async () => {
    const db = createMemoryDb();
    await upsertUser(db, { userId: 4001, username: 'limiter' });
    db.seedResource({ id: 1, short_code: 'CCCC3333', file_id: 'file-rate' });

    const start = new Date('2026-01-01T00:00:00.000Z');
    const first = await consumeRateLimit(db, 4001, 1, {
      now: start,
      intervalSeconds: 30,
    });
    expect(first.allowed).toBe(true);

    const blocked = await consumeRateLimit(db, 4001, 1, {
      now: new Date('2026-01-01T00:00:20.000Z'),
      intervalSeconds: 30,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    const checked = await checkRateLimit(db, 4001, 1, {
      now: new Date('2026-01-01T00:00:20.000Z'),
      intervalSeconds: 30,
    });
    expect(checked.allowed).toBe(false);

    const later = await consumeRateLimit(db, 4001, 1, {
      now: new Date('2026-01-01T00:00:40.000Z'),
      intervalSeconds: 30,
    });
    expect(later.allowed).toBe(true);
  });

  it('未配置间隔时使用默认 30 秒', async () => {
    const db = createMemoryDb();
    await upsertUser(db, { userId: 4002, username: 'default-window' });
    db.seedResource({ id: 2, short_code: 'DDDD4444', file_id: 'file-default' });
    const first = await consumeRateLimit(db, 4002, 2, {
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(first.limitSeconds).toBe(30);
  });
});
