import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALPHABET,
  FULL_ALPHABET,
  generateShortCode,
  isValidShortCode,
  SHORTCODE_LENGTH,
} from '../src/utils/shortcode';

const AMBIGUOUS_FREE = 'abcdefghijkmnpqrstuvwxyz23456789';

describe('shortcode', () => {
  it('生成 8 位短码', () => {
    const code = generateShortCode();
    expect(code).toHaveLength(SHORTCODE_LENGTH);
  });

  it('生成的短码仅包含默认字母表字符', () => {
    for (let i = 0; i < 100; i += 1) {
      const code = generateShortCode();
      for (const ch of code) {
        expect(DEFAULT_ALPHABET).toContain(ch);
      }
    }
  });

  it('默认字母表不包含易混淆字符', () => {
    expect(AMBIGUOUS_FREE).toBe(DEFAULT_ALPHABET);
    expect(DEFAULT_ALPHABET).not.toContain('0');
    expect(DEFAULT_ALPHABET).not.toContain('1');
    expect(DEFAULT_ALPHABET).not.toContain('o');
    expect(DEFAULT_ALPHABET).not.toContain('i');
    expect(DEFAULT_ALPHABET).not.toContain('l');
  });

  it('完整字母表包含全部小写字母和数字', () => {
    expect(FULL_ALPHABET).toBe('abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('只接受 8 位小写字母数字', () => {
    expect(isValidShortCode('abc12345')).toBe(true);
    expect(isValidShortCode('AbC12345')).toBe(false);
    expect(isValidShortCode('abc1234')).toBe(false);
    expect(isValidShortCode('abc123456')).toBe(false);
    expect(isValidShortCode('abc-1234')).toBe(false);
    expect(isValidShortCode('')).toBe(false);
  });
});
