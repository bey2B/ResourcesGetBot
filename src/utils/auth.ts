import bcrypt from 'bcryptjs';
import { jwtVerify, SignJWT } from 'jose';
import type { AdminJwtPayload, Env } from '../types';
import { AppError, parseUniqueCsv } from './helpers';

// ---------- 管理员身份与密码 ----------

export const DEFAULT_BCRYPT_ROUNDS = 10;
export const MAX_LOGIN_ATTEMPTS = 10;
export const LOGIN_LOCK_DURATION_MS = 15 * 60_000;
export const DEFAULT_JWT_TTL = '12h';

const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'cua-super-bot-admin';
const JWT_AUDIENCE = 'cua-super-bot-admin';

type AdminIdsEnv = Pick<Env, 'ADMIN_IDS'>;
type JwtEnv = Pick<Env, 'JWT_SECRET' | 'ADMIN_PASSWORD_HASH' | 'BOT_TOKEN'>;
type AdminAuthEnv = AdminIdsEnv & JwtEnv;

export function parseAdminIds(raw: string | undefined): number[] {
  return parseUniqueCsv(raw)
    .map((item) => Number(item))
    .filter((id) => Number.isInteger(id) && id > 0);
}

export function isAdminUserId(env: AdminIdsEnv, userId: number): boolean {
  return parseAdminIds(env.ADMIN_IDS).includes(userId);
}

export function getFirstAdminId(env: AdminIdsEnv): number | null {
  return parseAdminIds(env.ADMIN_IDS)[0] ?? null;
}

export async function hashAdminPassword(
  password: string,
  rounds = DEFAULT_BCRYPT_ROUNDS,
): Promise<string> {
  if (!password) {
    throw new AppError('密码不能为空', 400, 'VALIDATION_ERROR');
  }
  if (!Number.isInteger(rounds) || rounds < 4 || rounds > 15) {
    throw new AppError('bcrypt 轮数必须是 4 到 15 之间的整数', 400, 'VALIDATION_ERROR');
  }
  return bcrypt.hash(password, rounds);
}

export async function verifyAdminPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) {
    return false;
  }
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    // 非法哈希或格式异常统一按密码错误处理，不向调用方暴露细节
    return false;
  }
}

// ---------- 登录失败计数锁定 ----------
// 当前使用进程内 Map + 时间戳，Worker 单 isolate 内真实可用。
// 多副本部署时计数不共享，后续可迁移到 D1 的 rate_limits/独立登录锁定表。

export interface LoginLockState {
  locked: boolean;
  attempts: number;
  remainingAttempts: number;
  lockedUntil: number | null;
  retryAfterMs: number;
}

export class LoginAttemptTracker {
  private readonly failures = new Map<string, { attempts: number; lockedUntil: number | null }>();

  constructor(
    private readonly maxAttempts = MAX_LOGIN_ATTEMPTS,
    private readonly lockDurationMs = LOGIN_LOCK_DURATION_MS,
  ) {}

  getState(key: string, now = Date.now()): LoginLockState {
    const entry = this.failures.get(key);
    if (!entry) {
      return this.emptyState();
    }
    if (entry.lockedUntil !== null && entry.lockedUntil <= now) {
      this.failures.delete(key);
      return this.emptyState();
    }
    if (entry.lockedUntil !== null) {
      return {
        locked: true,
        attempts: entry.attempts,
        remainingAttempts: 0,
        lockedUntil: entry.lockedUntil,
        retryAfterMs: entry.lockedUntil - now,
      };
    }
    return {
      locked: false,
      attempts: entry.attempts,
      remainingAttempts: Math.max(0, this.maxAttempts - entry.attempts),
      lockedUntil: null,
      retryAfterMs: 0,
    };
  }

  recordFailure(key: string, now = Date.now()): LoginLockState {
    const current = this.getState(key, now);
    if (current.locked) {
      return current;
    }
    const attempts = current.attempts + 1;
    const lockedUntil = attempts >= this.maxAttempts ? now + this.lockDurationMs : null;
    this.failures.set(key, { attempts, lockedUntil });
    return this.getState(key, now);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private emptyState(): LoginLockState {
    return {
      locked: false,
      attempts: 0,
      remainingAttempts: this.maxAttempts,
      lockedUntil: null,
      retryAfterMs: 0,
    };
  }
}

export const defaultLoginTracker = new LoginAttemptTracker();

export type AdminLoginResult =
  | { ok: true; token: string; userId: number }
  | {
      ok: false;
      reason: 'locked' | 'invalid_password' | 'not_configured' | 'jwt_not_configured';
      attempts?: number;
      remainingAttempts?: number;
      retryAfterMs?: number;
    };

export async function attemptAdminLogin(
  env: AdminAuthEnv,
  password: string,
  clientIp: string | null | undefined,
  options: { tracker?: LoginAttemptTracker } = {},
): Promise<AdminLoginResult> {
  const tracker = options.tracker ?? defaultLoginTracker;
  const key = clientIp?.trim() || 'unknown';
  const lockedState = tracker.getState(key);
  if (lockedState.locked) {
    return {
      ok: false,
      reason: 'locked',
      attempts: lockedState.attempts,
      remainingAttempts: 0,
      retryAfterMs: lockedState.retryAfterMs,
    };
  }
  if (!env.JWT_SECRET?.trim()) {
    return { ok: false, reason: 'jwt_not_configured' };
  }
  if (!env.ADMIN_PASSWORD_HASH) {
    return { ok: false, reason: 'not_configured' };
  }
  const valid = await verifyAdminPassword(password, env.ADMIN_PASSWORD_HASH);
  if (!valid) {
    const state = tracker.recordFailure(key);
    if (state.locked) {
      return {
        ok: false,
        reason: 'locked',
        attempts: state.attempts,
        remainingAttempts: 0,
        retryAfterMs: state.retryAfterMs,
      };
    }
    return {
      ok: false,
      reason: 'invalid_password',
      attempts: state.attempts,
      remainingAttempts: state.remainingAttempts,
    };
  }
  tracker.reset(key);
  const userId = getFirstAdminId(env) ?? 0;
  const token = await signAdminToken(env, userId);
  return { ok: true, token, userId };
}

// ---------- JWT 签发与验证 ----------

export interface SignAdminTokenOptions {
  expiresIn?: string | number;
}

async function getJwtKey(env: JwtEnv): Promise<CryptoKey> {
  const configured = env.JWT_SECRET?.trim();
  if (!configured) {
    throw new AppError(
      'JWT_SECRET 未配置：请先为 Worker 配置 JWT_SECRET 环境变量后再登录。',
      500,
      'JWT_SECRET_MISSING',
    );
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(configured));
  return crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function signAdminToken(
  env: JwtEnv,
  userId: number,
  options: SignAdminTokenOptions = {},
): Promise<string> {
  if (!Number.isInteger(userId) || userId < 0) {
    throw new AppError('管理员 user_id 必须是大于等于 0 的整数', 400, 'VALIDATION_ERROR');
  }
  const key = await getJwtKey(env);
  return new SignJWT({ role: 'admin', userId })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? DEFAULT_JWT_TTL)
    .sign(key);
}

export async function verifyAdminToken(env: JwtEnv, token: string): Promise<AdminJwtPayload | null> {
  if (!token) {
    return null;
  }
  try {
    const key = await getJwtKey(env);
    const { payload } = await jwtVerify(token, key, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (
      payload.role !== 'admin' ||
      typeof payload.userId !== 'number' ||
      typeof payload.sub !== 'string'
    ) {
      return null;
    }
    if (payload.sub !== String(payload.userId)) {
      return null;
    }
    return { sub: payload.sub, role: 'admin', userId: payload.userId };
  } catch {
    // 过期、篡改、密钥不匹配等一律视为无效令牌
    return null;
  }
}

// ---------- IP 白名单 ----------

export function parseIpWhitelist(raw: string | undefined): string[] {
  return parseUniqueCsv(raw).map((item) => item.trim());
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    result = (result * 256 + octet) >>> 0;
  }
  return result;
}

function ipMatches(ip: string, entry: string): boolean {
  const normalizedEntry = entry.trim();
  if (normalizedEntry.includes('/')) {
    const [base, maskRaw] = normalizedEntry.split('/');
    const mask = Number(maskRaw);
    if (!Number.isInteger(mask) || mask < 0 || mask > 32) {
      return false;
    }
    const ipInt = ipv4ToInt(ip);
    const baseInt = ipv4ToInt(base ?? '');
    if (ipInt === null || baseInt === null) {
      return false;
    }
    const maskInt = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
    return (ipInt & maskInt) === (baseInt & maskInt);
  }
  return ip === normalizedEntry;
}

export function isIpAllowed(
  env: Pick<Env, 'ADMIN_IP_WHITELIST'>,
  clientIp: string | null | undefined,
): boolean {
  const whitelist = parseIpWhitelist(env.ADMIN_IP_WHITELIST);
  if (whitelist.length === 0) {
    return true;
  }
  if (!clientIp) {
    return false;
  }
  // 支持精确 IPv4/IPv6 与 IPv4 CIDR；IPv6 网段请直接配置精确地址
  return whitelist.some((entry) => ipMatches(clientIp, entry));
}
