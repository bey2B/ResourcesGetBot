import type {
  D1ExecResult,
  D1PreparedStatement,
  D1Result,
} from '@cloudflare/workers-types';

type Row = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function emptyMeta(changes = 0, lastRowId = 0): D1Result<unknown>['meta'] {
  return {
    changes,
    last_row_id: lastRowId,
    duration: 0,
    rows_read: 0,
    rows_written: changes,
    size_after: 0,
    changed_db: false,
  };
}

export class MemoryD1 {
  users: Row[] = [];
  resources: Row[] = [];
  downloads: Row[] = [];
  checkins: Row[] = [];
  pointsLogs: Row[] = [];
  rateLimits: Row[] = [];
  settings: Row[] = [];
  ads: Row[] = [];
  purchases: Row[] = [];

  private nextId: Record<string, number> = {
    users: 1,
    resources: 1,
    downloads: 1,
    checkins: 1,
    pointsLogs: 1,
    ads: 1,
    purchases: 1,
  };
  private lastInsertId = 0;

  prepare(sql: string): D1PreparedStatement {
    return new MemoryStatement(this, sql);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const statement of statements) {
      const memoryStatement = statement as unknown as MemoryStatement;
      results.push((await memoryStatement.run<T>()) as D1Result<T>);
    }
    return results;
  }

  async exec(): Promise<D1ExecResult> {
    // 测试仅覆盖 prepare/batch 路径，exec 直接成功返回。
    return { count: 0, duration: 0 };
  }

  withSession(constraintOrBookmark?: string): never {
    void constraintOrBookmark;
    throw new Error('withSession 未在测试 mock 中实现');
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }

  seedUser(input: Row): Row {
    const row: Row = {
      user_id: input.user_id,
      username: input.username ?? null,
      first_name: input.first_name ?? null,
      points: input.points ?? 0,
      invited_by: input.invited_by ?? null,
      is_banned: input.is_banned ?? 0,
      created_at: input.created_at ?? nowIso(),
      last_active: input.last_active ?? null,
    };
    const index = this.users.findIndex((item) => item.user_id === row.user_id);
    if (index >= 0) {
      this.users[index] = row;
    } else {
      this.users.push(row);
    }
    return row;
  }

  seedResource(input: Row): Row {
    const row: Row = {
      id: input.id ?? this.nextId.resources++,
      short_code: input.short_code,
      file_id: input.file_id,
      file_unique_id: input.file_unique_id ?? null,
      file_ids: input.file_ids ?? JSON.stringify([input.file_id]),
      title: input.title ?? '',
      tags: input.tags ?? '',
      is_paid: input.is_paid ?? 0,
      price: input.price ?? 0,
      sequence: input.sequence ?? this.resources.length,
      download_count: input.download_count ?? 0,
      creator_id: input.creator_id ?? null,
      created_at: input.created_at ?? nowIso(),
      updated_at: input.updated_at ?? nowIso(),
    };
    this.resources.push(row);
    return row;
  }

  seedAd(input: Row): Row {
    const row: Row = {
      id: input.id ?? this.nextId.ads++,
      position: input.position,
      content: input.content,
      weight: input.weight ?? 1,
      enabled: input.enabled ?? 1,
      created_at: input.created_at ?? nowIso(),
      updated_at: input.updated_at ?? nowIso(),
    };
    this.ads.push(row);
    return row;
  }

  query(sql: string, values: unknown[]): Row[] {
    const normalized = normalize(sql);
    if (normalized.startsWith('select')) {
      return this.select(normalized, values);
    }
    this.mutate(normalized, values);
    return [];
  }

  execute(sql: string, values: unknown[]): D1Result<unknown> {
    const normalized = normalize(sql);
    if (normalized.startsWith('select')) {
      const rows = this.select(normalized, values);
      return {
        results: rows,
        success: true,
        meta: emptyMeta(rows.length),
      };
    }
    this.lastInsertId = 0;
    const changes = this.mutate(normalized, values);
    return {
      results: [],
      success: true,
      meta: emptyMeta(changes, this.lastInsertId),
    };
  }

  private select(sql: string, values: unknown[]): Row[] {
    const table = /from\s+([a-z_]+)/.exec(sql)?.[1];
    if (table === 'users') {
      return this.users.filter((row) => row.user_id === values[0]);
    }
    if (table === 'resources') {
      const target = values[0];
      return this.resources.filter(
        (row) => row.short_code === target || row.id === target,
      );
    }
    if (table === 'checkins') {
      return this.checkins
        .filter((row) => row.user_id === values[0] && row.date === values[1])
        .slice(0, 1);
    }
    if (table === 'settings') {
      const row = this.settings.find((item) => item.key === values[0]);
      return row ? [row] : [];
    }
    if (table === 'points_logs') {
      if (sql.includes('where id = ?')) {
        return this.pointsLogs.filter((row) => row.id === values[0]);
      }
      const userId = values[0];
      const limit = Number(values[1] ?? 50);
      const offset = Number(values[2] ?? 0);
      return this.pointsLogs
        .filter((row) => row.user_id === userId)
        .sort((a, b) => {
          const byTime = String(b.created_at).localeCompare(String(a.created_at));
          return byTime || Number(b.id) - Number(a.id);
        })
        .slice(offset, offset + limit);
    }
    if (table === 'rate_limits') {
      return this.rateLimits.filter(
        (row) => row.user_id === values[0] && row.resource_id === values[1],
      );
    }
    if (table === 'ads') {
      return this.ads.filter(
        (row) => row.position === values[0] && row.enabled === 1,
      );
    }
    if (table === 'purchases') {
      return this.purchases.filter(
        (row) => row.user_id === values[0] && row.resource_id === values[1],
      );
    }
    return [];
  }

  private mutate(sql: string, values: unknown[]): number {
    const table = /(?:into|update)\s+([a-z_]+)/.exec(sql)?.[1];
    if (table === 'users' && sql.includes('set points = points +')) {
      const user = this.users.find((row) => row.user_id === values[1]);
      if (!user) {
        return 0;
      }
      user.points = Number(user.points ?? 0) + Number(values[0]);
      return 1;
    }
    if (table === 'users' && sql.includes('set points = ?')) {
      const user = this.users.find((row) => row.user_id === values[1]);
      if (!user) {
        return 0;
      }
      user.points = values[0];
      return 1;
    }
    if (table === 'users') {
      const columns = /\(([^)]+)\)\s*values/.exec(sql)?.[1]
        ?.split(',')
        .map((item) => item.trim());
      if (!columns) {
        return 0;
      }
      const existing = this.users.find((row) => row.user_id === values[0]);
      if (existing) {
        const patch: Row = {};
        columns.forEach((column, index) => {
          patch[column] = values[index];
        });
        existing.username =
          patch.username === null || patch.username === undefined
            ? existing.username
            : patch.username;
        existing.first_name =
          patch.first_name === null || patch.first_name === undefined
            ? existing.first_name
            : patch.first_name;
        existing.last_active = patch.last_active ?? existing.last_active;
        return 1;
      }
      const row: Row = {
        user_id: values[0],
        username: values[1] ?? null,
        first_name: values[2] ?? null,
        invited_by: values[3] ?? null,
        created_at: values[4] ?? nowIso(),
        last_active: values[5] ?? null,
        points: 0,
        is_banned: 0,
      };
      this.users.push(row);
      this.lastInsertId = row.user_id as number;
      return 1;
    }
    if (table === 'checkins') {
      const duplicate = this.checkins.some(
        (row) => row.user_id === values[0] && row.date === values[1],
      );
      if (duplicate) {
        return 0;
      }
      const row: Row = {
        id: this.nextId.checkins++,
        user_id: values[0],
        date: values[1],
        created_at: nowIso(),
      };
      this.checkins.push(row);
      this.lastInsertId = row.id as number;
      return 1;
    }
    if (table === 'points_logs') {
      const row: Row = {
        id: this.nextId.pointsLogs++,
        user_id: values[0],
        change: values[1],
        balance_after: values[2],
        reason: values[3],
        related_id: values[4] ?? null,
        created_at: nowIso(),
      };
      this.pointsLogs.push(row);
      this.lastInsertId = row.id as number;
      return 1;
    }
    if (table === 'downloads') {
      const row: Row = {
        id: this.nextId.downloads++,
        user_id: values[0],
        resource_id: values[1],
        created_at: values[2] ?? nowIso(),
      };
      this.downloads.push(row);
      this.lastInsertId = row.id as number;
      return 1;
    }
    if (table === 'purchases') {
      const duplicate = this.purchases.some(
        (row) => row.user_id === values[0] && row.resource_id === values[1],
      );
      if (duplicate) {
        return 0;
      }
      const row: Row = {
        id: this.nextId.purchases++,
        user_id: values[0],
        resource_id: values[1],
        price: values[2],
        created_at: values[3] ?? nowIso(),
      };
      this.purchases.push(row);
      this.lastInsertId = row.id as number;
      return 1;
    }
    if (table === 'rate_limits') {
      const existing = this.rateLimits.find(
        (row) => row.user_id === values[0] && row.resource_id === values[1],
      );
      if (existing) {
        existing.last_request = values[2];
        return 1;
      }
      this.rateLimits.push({
        user_id: values[0],
        resource_id: values[1],
        last_request: values[2],
        created_at: nowIso(),
      });
      return 1;
    }
    if (table === 'settings') {
      const existing = this.settings.find((row) => row.key === values[0]);
      if (existing) {
        existing.value = values[1];
        existing.updated_at = nowIso();
      } else {
        this.settings.push({
          key: values[0],
          value: values[1],
          updated_at: nowIso(),
        });
      }
      return 1;
    }
    if (table === 'resources' && sql.includes('set download_count')) {
      const resource = this.resources.find((row) => row.id === values[0]);
      if (!resource) {
        return 0;
      }
      resource.download_count = Number(resource.download_count ?? 0) + 1;
      return 1;
    }
    return 0;
  }
}

class MemoryStatement implements D1PreparedStatement {
  private readonly boundValues: unknown[] = [];

  constructor(
    private readonly db: MemoryD1,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.boundValues.push(...values);
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const rows = this.db.query(this.sql, this.boundValues);
    const row = rows[0] ?? null;
    if (colName && row) {
      return (row as Row)[colName] as T;
    }
    return row as T | null;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.db.execute(this.sql, this.boundValues) as D1Result<T>;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const rows = this.db.query(this.sql, this.boundValues);
    return {
      results: rows as T[],
      success: true,
      meta: emptyMeta(rows.length),
    };
  }

  async raw<T = unknown[]>(
    options?: { columnNames?: boolean },
  ): Promise<[string[], ...T[]] | T> {
    const rows = this.db.query(this.sql, this.boundValues) as T[];
    if (options?.columnNames) {
      const columns = Object.keys((rows[0] ?? {}) as Record<string, unknown>);
      return [columns, ...rows] as unknown as [string[], ...T[]];
    }
    return rows as T;
  }

  async values(): Promise<unknown[][]> {
    return this.db.query(this.sql, this.boundValues).map((row) => Object.values(row));
  }
}

export function createMemoryDb(): MemoryD1 {
  return new MemoryD1();
}
