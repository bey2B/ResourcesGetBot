import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SHORT_CODE_LENGTH,
  generateShortCode,
  generateUniqueShortCode,
  isValidShortCode,
} from '../src/utils/shortcode';
import { createMemoryDb } from './helpers/d1-mock';

const AMBIGUOUS_FREE = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shortcode', () => {
  it('生成 8 位且不含易混淆字符的短码', () => {
    for (let index = 0; index < 100; index += 1) {
      const code = generateShortCode();
      expect(code).toHaveLength(DEFAULT_SHORT_CODE_LENGTH);
      expect([...code].every((char) => AMBIGUOUS_FREE.includes(char))).toBe(true);
    }
  });

  it('isValidShortCode 只接受 8 位字母数字', () => {
    expect(isValidShortCode('AbC12345')).toBe(true);
    expect(isValidShortCode('abc1234')).toBe(false);
    expect(isValidShortCode('abc123456')).toBe(false);
    expect(isValidShortCode('abc 1234')).toBe(false);
  });

  it('generateUniqueShortCode 遇到碰撞会重试并返回未使用短码', async () => {
    let randomCall = 0;
    vi.stubGlobal('crypto', {
      getRandomValues: (buffer: Uint32Array) => {
        buffer[0] = randomCall++;
        return buffer;
      },
    });

    const db = createMemoryDb();
    const deterministicCode = '23456789';
    db.seedResource({ id: 1, short_code: deterministicCode, file_id: 'seed-file' });

    const unique = await generateUniqueShortCode(db);
    expect(unique).toHaveLength(DEFAULT_SHORT_CODE_LENGTH);
    expect(unique).not.toBe(deterministicCode);
    expect(db.resources.some((row) => row.short_code === unique)).toBe(false);
  });
});
