# 广播分批发送修复：开发计划

目标：修复「立即广播永久卡在发送中」——单次 waitUntil 遍历 10,703 用户被 Worker 超时终止，进度从未回写。
用户已给定方案：游标分批 + 每分钟 Cron + sending 状态恢复。

## 任务拆解

| 编号 | 任务 | 状态 |
| --- | --- | --- |
| B1 | broadcasts 表新增游标字段 last_user_id + 迁移 SQL | ✅ |
| B2 | 数据层：批量取用户 / 计数 / 续排期 / 陈旧恢复 / 落盘游标 / 周期重置 | ✅ |
| B3 | executeBroadcast 改为单批执行，未发完置 pending 并 1 分钟后到期 | ✅ |
| B4 | runBroadcastCron 每轮先恢复陈旧 sending 再处理一批 | ✅ |
| B5 | index.ts 新增每分钟触发器，避免每分钟刷屏通知 | ✅ |
| B6 | 单测：真实 schema + node:sqlite 覆盖首批/续发/收尾/恢复/防误判 | ✅ |
| B7 | 验证：tsc、vitest、10,703 用户规模仿真 | ✅ |

## 关键参数

- `DEFAULT_BATCH_SIZE = 300`：单批上限，约 10.5 秒（35ms × 300）
- `DEFAULT_FLUSH_EVERY = 50`：落盘粒度，中断最多重复 50 人
- `BATCH_CONTINUE_DELAY_MS = 60_000`：下一批到期时间，交给每分钟 Cron
- `staleSendingMinutes = 5`：陈旧 sending 阈值，小于该值会误判正在发送的批次

## 部署前置条件（必须按顺序）

1. 生产库执行 `migrations/0001_broadcast_batching.sql` 加字段，否则 SELECT 读不到 last_user_id，广播会报错。
2. `wrangler.toml`（不在仓库内）的 `triggers.crons` 补 `* * * * *`，否则每分钟续发不会触发。
3. 部署后第一轮 Cron 会把 #10/#11/#12 恢复并真正补发；若不想补发，先把它们置为 cancelled（迁移文件末尾已附语句）。

## 设计说明

分批发送引入了游标、续排期、陈旧恢复这一套只属于广播状态机的读写，与 queries.ts 里的通用 CRUD 不是一类东西，
因此单独放在 `src/db/broadcast-batch.ts`，避免继续撑大 2159 行的通用查询层。
