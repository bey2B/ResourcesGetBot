-- Cua超级助手 Telegram Bot：Cloudflare D1 数据库 Schema
-- 所有时间字段统一存储 UTC ISO-8601 字符串（例如 2026-08-09T08:30:00.000Z），展示层再转换为本地时间。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id     INTEGER PRIMARY KEY,             -- Telegram 用户 ID
  username    TEXT,                            -- Telegram 用户名（可空）
  first_name  TEXT,                            -- 展示昵称（可空）
  points      INTEGER NOT NULL DEFAULT 0,      -- 当前积分
  invited_by  INTEGER,                         -- 邀请人 user_id
  is_banned   INTEGER NOT NULL DEFAULT 0 CHECK (is_banned IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_active TEXT,                            -- 最近活跃时间（UTC）
  FOREIGN KEY (invited_by) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS resources (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  short_code     TEXT NOT NULL UNIQUE,          -- 8 位随机短码，全局唯一
  file_id        TEXT NOT NULL,                 -- Telegram 文件 ID
  file_unique_id TEXT,                          -- Telegram 文件唯一 ID（可空）
  file_ids       TEXT NOT NULL DEFAULT '',      -- 完整文件 ID 列表（JSON 数组，首个与 file_id 一致）
  title          TEXT NOT NULL DEFAULT '',
  tags           TEXT NOT NULL DEFAULT '',      -- 逗号分隔标签
  is_paid        INTEGER NOT NULL DEFAULT 0 CHECK (is_paid IN (0, 1)),
  price          INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  sequence       INTEGER NOT NULL UNIQUE,       -- 全局唯一递增序号（从 0 开始）
  download_count INTEGER NOT NULL DEFAULT 0,    -- 下载次数
  creator_id     INTEGER,                       -- 上传管理员 user_id
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (creator_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- 资源-文件多对多：一个资源可关联多个媒体文件，按 sort_order 有序交付
CREATE TABLE IF NOT EXISTS resource_files (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id    INTEGER NOT NULL,
  file_id        TEXT NOT NULL,
  file_unique_id TEXT,                          -- Telegram 文件唯一 ID（可空）
  media_type     TEXT NOT NULL DEFAULT '',      -- photo/video/document/audio/voice/sticker/animation/video_note
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (resource_id, file_id),
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS downloads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  resource_id INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);

-- 购买记录：付费资源一次性购买，user_id + resource_id 唯一
CREATE TABLE IF NOT EXISTS purchases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  resource_id INTEGER NOT NULL,
  price       INTEGER NOT NULL CHECK (price >= 0),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, resource_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checkins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  date       TEXT NOT NULL,                    -- UTC 日期 YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sending', 'sent', 'partial', 'failed', 'cancelled', 'scheduled')),
  type          TEXT NOT NULL DEFAULT 'now'
                CHECK (type IN ('now', 'once', 'daily', 'weekly', 'monthly')),
  scheduled_at  TEXT,                          -- 下次发送时间（UTC），立即广播为创建时间
  created_by    INTEGER NOT NULL DEFAULT 0,    -- 创建人 user_id
  total_count   INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count    INTEGER NOT NULL DEFAULT 0,
  skip_count    INTEGER NOT NULL DEFAULT 0,
  finished_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS ads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  position   TEXT NOT NULL CHECK (position IN ('top', 'bottom')),
  content    TEXT NOT NULL,
  weight     INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 0),
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 广告独立消息：文字 + 媒体 file_id + 按钮（buttons 为 JSON 数组 [{text,url}]）
CREATE TABLE IF NOT EXISTS ad_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id           INTEGER NOT NULL UNIQUE,
  text            TEXT NOT NULL DEFAULT '',
  media_file_id   TEXT,
  media_unique_id TEXT,
  media_type      TEXT NOT NULL DEFAULT '',
  buttons         TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (ad_id) REFERENCES ads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   INTEGER NOT NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id      INTEGER NOT NULL,
  resource_id  INTEGER NOT NULL,
  last_request TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, resource_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);

-- 积分流水：支撑积分日志与积分循环统计
CREATE TABLE IF NOT EXISTS points_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  change        INTEGER NOT NULL,              -- 正数为增加，负数为扣减
  balance_after INTEGER NOT NULL,              -- 操作后的余额
  reason        TEXT NOT NULL,
  related_id    INTEGER,                       -- 关联资源/用户等 ID（可空）
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 索引：覆盖按时间聚合、邀请关系、限流清理等高频查询
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_invited_by ON users(invited_by);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active);
CREATE INDEX IF NOT EXISTS idx_users_is_banned ON users(is_banned);

CREATE INDEX IF NOT EXISTS idx_resources_created_at ON resources(created_at);
CREATE INDEX IF NOT EXISTS idx_resources_download_count ON resources(download_count);
CREATE INDEX IF NOT EXISTS idx_resources_is_paid ON resources(is_paid);
CREATE INDEX IF NOT EXISTS idx_resources_creator_id ON resources(creator_id);

CREATE INDEX IF NOT EXISTS idx_resource_files_resource_sort ON resource_files(resource_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_resource_files_file_id ON resource_files(file_id);

CREATE INDEX IF NOT EXISTS idx_downloads_user_created ON downloads(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_downloads_resource_created ON downloads(resource_id, created_at);
CREATE INDEX IF NOT EXISTS idx_downloads_created_at ON downloads(created_at);

CREATE INDEX IF NOT EXISTS idx_purchases_user_created ON purchases(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_purchases_resource_created ON purchases(resource_id, created_at);

CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(date);

CREATE INDEX IF NOT EXISTS idx_broadcasts_status_scheduled ON broadcasts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_broadcasts_created_at ON broadcasts(created_at);

CREATE INDEX IF NOT EXISTS idx_ads_position_enabled ON ads(position, enabled);
CREATE INDEX IF NOT EXISTS idx_ad_messages_ad_id ON ad_messages(ad_id);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin_id ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_rate_limits_last_request ON rate_limits(last_request);

CREATE INDEX IF NOT EXISTS idx_points_logs_user_created ON points_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_points_logs_reason ON points_logs(reason);
CREATE INDEX IF NOT EXISTS idx_points_logs_created_at ON points_logs(created_at);
