export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = 'API_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const TOKEN_KEY = 'cua_admin_token';
const EXPIRES_KEY = 'cua_admin_expires_at';

const BASE_URL = (
  (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/admin'
).replace(/\/+$/, '');

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRES_KEY);
}

export type Query = Record<string, string | number | boolean | undefined | null>;

function buildQuery(params?: Query): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

interface ErrorLike {
  code?: string;
  message?: string;
}

interface ApiBody {
  success?: boolean;
  data?: unknown;
  error?: ErrorLike | string;
  message?: string;
  code?: string;
}

function readErrorMessage(record: ApiBody): string | undefined {
  const error = record.error;
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return undefined;
}

function readErrorCode(record: ApiBody): string | undefined {
  const error = record.error;
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    return error.code;
  }
  return record.code;
}

function extractMessage(body: unknown, status: number, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as ApiBody;
    const errorMessage = readErrorMessage(record);
    if (errorMessage) return errorMessage;
    if (record.message) return record.message;
    if (record.code === 'RATE_LIMITED') return '操作过于频繁，请稍后再试';
  }
  if (status === 401) return '密码错误或登录已失效';
  return fallback;
}

function unwrap<T>(data: unknown): T {
  if (data && typeof data === 'object') {
    const record = data as ApiBody;
    if (record.success === true && 'data' in record) {
      return record.data as T;
    }
    if (record.success === false) {
      throw new ApiError(
        400,
        readErrorMessage(record) ?? '请求失败',
        readErrorCode(record) ?? 'API_ERROR',
      );
    }
  }
  return data as T;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Query,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}${buildQuery(params)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, '无法连接管理后台服务，请确认 Worker 已启动', 'NETWORK_ERROR');
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (response.status === 401 && !path.startsWith('/login')) {
    clearAuth();
    if (window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
    throw new ApiError(401, '登录已过期，请重新登录', 'UNAUTHORIZED');
  }

  if (!response.ok) {
    const record = data as ApiBody | null;
    throw new ApiError(
      response.status,
      extractMessage(data, response.status, `请求失败（HTTP ${response.status}）`),
      record ? readErrorCode(record) ?? 'HTTP_ERROR' : 'HTTP_ERROR',
    );
  }

  return unwrap<T>(data);
}

export const api = {
  get: <T>(path: string, params?: Query) => request<T>('GET', path, undefined, params),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
