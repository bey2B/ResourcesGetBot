export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function formatNumber(value?: number | null): string {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num.toLocaleString('zh-CN') : '0';
}

export function truncate(value: string, length: number): string {
  if (!value) return '';
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '操作失败');
}
