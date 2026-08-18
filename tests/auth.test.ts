import { describe, expect, it } from 'vitest';
import {
  LoginAttemptTracker,
  attemptAdminLogin,
  hashAdminPassword,
  signAdminToken,
  verifyAdminPassword,
  verifyAdminToken,
} from '../src/utils/auth';

const BASE_ENV = {
  ADMIN_PASSWORD_HASH: '',
  JWT_SECRET: 'test-jwt-secret',
  ADMIN_IDS: '123,456',
  BOT_TOKEN: '123456:TEST',
};

describe('auth', () => {
  it('bcrypt 密码比对：正确通过、错误拒绝', async () => {
    const hash = await hashAdminPassword('strong-pass-2026');
    expect(await verifyAdminPassword('strong-pass-2026', hash)).toBe(true);
    expect(await verifyAdminPassword('wrong-pass', hash)).toBe(false);
    expect(await verifyAdminPassword('', hash)).toBe(false);
  });

  it('登录成功返回可验证 JWT，错误密码返回 invalid_password', async () => {
    const hash = await hashAdminPassword('admin-pass');
    const env = { ...BASE_ENV, ADMIN_PASSWORD_HASH: hash };
    const failed = await attemptAdminLogin(env, 'bad-pass', '203.0.113.1');
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error('unreachable');
    expect(failed.reason).toBe('invalid_password');

    const success = await attemptAdminLogin(env, 'admin-pass', '203.0.113.1');
    expect(success.ok).toBe(true);
    if (!success.ok) throw new Error('unreachable');
    expect(success.userId).toBe(123);
    const payload = await verifyAdminToken(env, success.token);
    expect(payload?.userId).toBe(123);
    expect(payload?.role).toBe('admin');
  });

  it('JWT_SECRET 未配置时登录明确失败', async () => {
    const hash = await hashAdminPassword('admin-pass');
    const result = await attemptAdminLogin(
      { ...BASE_ENV, JWT_SECRET: '', ADMIN_PASSWORD_HASH: hash },
      'admin-pass',
      '203.0.113.2',
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('jwt_not_configured');
  });

  it('ADMIN_PASSWORD_HASH 未配置时登录明确失败', async () => {
    const result = await attemptAdminLogin(
      { ...BASE_ENV, ADMIN_PASSWORD_HASH: '' },
      'admin-pass',
      '203.0.113.3',
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('not_configured');
  });

  it('连续失败达到阈值后锁定，锁定期间即使密码正确也拒绝', async () => {
    const hash = await hashAdminPassword('admin-pass');
    const env = { ...BASE_ENV, ADMIN_PASSWORD_HASH: hash };
    const tracker = new LoginAttemptTracker(3, 60_000);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await attemptAdminLogin(env, 'bad-pass', '203.0.113.4', { tracker });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.reason).toBe(attempt < 3 ? 'invalid_password' : 'locked');
    }
    const locked = await attemptAdminLogin(env, 'admin-pass', '203.0.113.4', { tracker });
    expect(locked.ok).toBe(false);
    if (locked.ok) throw new Error('unreachable');
    expect(locked.reason).toBe('locked');
    expect(locked.retryAfterMs).toBeGreaterThan(0);
  });

  it('过期或篡改的 JWT 校验失败', async () => {
    const env = { ...BASE_ENV, ADMIN_PASSWORD_HASH: 'x' };
    const expired = await signAdminToken(env, 123, {
      expiresIn: Math.floor(Date.now() / 1000) - 10,
    });
    expect(await verifyAdminToken(env, expired)).toBeNull();

    const valid = await signAdminToken(env, 123);
    const tampered = `${valid.slice(0, -1)}x`;
    expect(await verifyAdminToken(env, tampered)).toBeNull();
  });
});
