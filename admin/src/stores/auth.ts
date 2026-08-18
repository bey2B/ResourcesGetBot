import { defineStore } from 'pinia';
import { api } from '@/api/client';
import type { LoginResponse } from '@/api/types';

const TOKEN_KEY = 'cua_admin_token';
const EXPIRES_KEY = 'cua_admin_expires_at';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function isExpired(expiresAt: string): boolean {
  if (!expiresAt) return false;
  const time = new Date(expiresAt).getTime();
  return Number.isNaN(time) ? false : time <= Date.now();
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) ?? '',
    expiresAt: localStorage.getItem(EXPIRES_KEY) ?? '',
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.token) && !isExpired(state.expiresAt),
  },
  actions: {
    async login(password: string) {
      const data = await api.post<LoginResponse>('/login', { password });
      if (!data?.token) {
        throw new Error('登录响应缺少 token');
      }
      const expiresAt = data.expiresAt ?? new Date(Date.now() + DEFAULT_TTL_MS).toISOString();
      this.token = data.token;
      this.expiresAt = expiresAt;
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(EXPIRES_KEY, expiresAt);
    },
    logout() {
      this.token = '';
      this.expiresAt = '';
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EXPIRES_KEY);
    },
  },
});
