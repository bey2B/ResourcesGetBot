import { getResourceByShortCode } from '../db/queries';

export const DEFAULT_SHORT_CODE_LENGTH = 8;
export const MAX_SHORT_CODE_ATTEMPTS = 20;

// 默认字符集：仅小写字母+数字，剔除易混淆字符 0/1/l
const DEFAULT_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';
const FULL_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export interface ShortCodeOptions {
  length?: number;
  avoidAmbiguous?: boolean;
  alphabet?: string;
}

function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 0x100000000) {
    throw new Error('随机数上限必须是 1 到 2^32 之间的整数');
  }
  // 拒绝采样消除模运算偏差，保证均匀分布
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % max;
}

export function generateShortCode(options: ShortCodeOptions = {}): string {
  const length = options.length ?? DEFAULT_SHORT_CODE_LENGTH;
  if (!Number.isInteger(length) || length < 1 || length > 64) {
    throw new Error(`短码长度必须是 1 到 64 之间的整数，当前为 ${length}`);
  }
  const alphabet = options.alphabet ?? (options.avoidAmbiguous === false ? FULL_ALPHABET : DEFAULT_ALPHABET);
  if (alphabet.length === 0) {
    throw new Error('短码字符集不能为空');
  }
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += alphabet[randomInt(alphabet.length)];
  }
  return code;
}

export async function generateUniqueShortCode(
  db: D1Database,
  options: ShortCodeOptions = {},
): Promise<string> {
  for (let attempt = 0; attempt < MAX_SHORT_CODE_ATTEMPTS; attempt += 1) {
    const code = generateShortCode(options);
    const existing = await getResourceByShortCode(db, code);
    if (!existing) {
      return code;
    }
  }
  throw new Error(`生成唯一短码失败：已连续重试 ${MAX_SHORT_CODE_ATTEMPTS} 次仍发生碰撞`);
}

export function isValidShortCode(code: string): boolean {
  return new RegExp(`^[a-z0-9]{${DEFAULT_SHORT_CODE_LENGTH}}$`).test(code);
}
