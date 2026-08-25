/**
 * 短码生成与校验：8 位小写字母数字，排除易混淆字符（0/O/1/I/L）。
 */

const DEFAULT_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const FULL_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SHORTCODE_LENGTH = 8;

export function generateShortCode(alphabet = DEFAULT_ALPHABET): string {
  const chars = alphabet.length;
  let result = '';
  const bytes = new Uint8Array(SHORTCODE_LENGTH);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < SHORTCODE_LENGTH; i += 1) {
    result += alphabet[bytes[i] % chars];
  }
  return result;
}

export function isValidShortCode(value: string): boolean {
  return /^[a-z0-9]{8}$/.test(value);
}

export { DEFAULT_ALPHABET, FULL_ALPHABET, SHORTCODE_LENGTH };
