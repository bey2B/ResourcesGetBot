-- 广播分批发送：新增游标字段
-- 应用方式（生产库）：
--   npx wrangler d1 execute cua-super-bot-db --remote --file=migrations/0001_broadcast_batching.sql
--
-- 只加字段，不改动历史数据。历史广播（#10/#11/#12）会在部署后第一轮 Cron
-- 被「陈旧 sending 恢复」自动救活并从游标 0 开始真正发送。
-- 如果不想补发这些历史内容，部署前先执行文件末尾的取消语句。

-- 游标：记录已经处理到的最大 user_id，下一批从这里继续，避免每次从头重发
ALTER TABLE broadcasts ADD COLUMN last_user_id INTEGER NOT NULL DEFAULT 0;


-- ============================================================
-- 可选：如果不想让历史卡死的广播在部署后被补发，先执行下面这段
-- 把它们标记为 cancelled（不影响新广播的游标逻辑）
-- ============================================================
-- UPDATE broadcasts
-- SET status = 'cancelled',
--     finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
--     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
-- WHERE status = 'sending';
