
## 通用经验

- PowerShell 读取 UTF-8 中文文件需显式指定 UTF-8 编码（例如 `[System.IO.File]::ReadAllText(path, UTF8)`），否则会乱码。
- wrangler v4 已移除 `wrangler build`，构建验证使用 `tsc --noEmit` + `wrangler deploy --dry-run`。
- wrangler.toml 中 D1 `database_id` 占位应使用合法 UUID 格式，避免配置校验报错。
- 本地执行 `wrangler d1 execute <db> --local --file=...` 会自动在 `.wrangler/state/v3/d1` 建本地库，无需先执行 `wrangler d1 create`；占位 UUID 即可满足本地验证。

## 任务 2 经验

- `bcryptjs` 与 `jose` 均为纯 JS，可直接在 Cloudflare Workers 中打包运行；JWT 使用 HS256 + Web Crypto（`crypto.subtle`）。
- 登录失败锁定若用内存 Map 实现，仅在单个 isolate 内有效；多副本/生产环境需迁移到 D1 共享计数（或 KV）。
- `tsx` 可用于本地对 `src/utils/*` 做临时 TS 冒烟验证，临时脚本验证后需删除，不留仓库文件。

## 任务 3 经验

- `queries.ts` 已内置加权广告轮换、限流持久化、积分流水与统计聚合，服务层直接组合复用，不需要重复写 SQL。
- 签到去重直接依赖 `INSERT OR IGNORE` 的 `meta.changes`，并发下也只有一次能拿到积分；邀请奖励去重使用积分流水 `reason + related_id` 判断。
- 订阅校验把 Telegram `getChatMember` 请求抽成可注入的 fetcher，本地冒烟测试无需真实 Bot API。
- 内存版 D1 mock 需覆盖 `prepare/bind/run/first/all/batch`，且 INSERT 后回读要返回 `meta.last_row_id`；`listPointsLogs` 绑定顺序为 `user_id, pageSize, offset`，mock 分页参数需对应。

## 任务 4 经验

- grammY 中注册 `:text` 等宽过滤器时，不匹配的分支必须调用 `next()`，否则会截断后续 middleware（例如签到、命令处理器），导致下游永远收不到更新。
- Worker 环境没有模块级 `env`，`bot.ts` 用 `ContextConstructor` 子类在中间件里写入 `ctx.env`，每次 webhook 请求由 `createBot(env)` 构造实例；`registerHandlers` 保持可复用。
- schema 未保存媒体类型，资源交付按 `sendDocument`、`sendPhoto`、`sendVideo`、`sendAnimation`、`sendAudio`、`sendVoice`、`sendVideoNote`、`sendSticker` 顺序回退发送 `file_id`。
- 群组延迟删除优先使用 Worker `ctx.waitUntil` 挂后台任务，未注入时用 `setTimeout` 兜底，保证本地/测试也能运行。
- 冒烟脚本用内存 D1 mock 直接覆盖 `dailyCheckIn` 与 `purchaseResource`，可验证签到文案、同日去重、积分不足提示与购买后下载记录。

## 任务 5 经验

- 定时广播要求 `status='scheduled'`，必须同步扩展 `schema.sql` 的 CHECK 约束、`types.ts` 与 `queries.ts` 的 `BroadcastStatus` 联合类型，否则 D1 写入会被 CHECK 拒绝，TS 也报类型错误。
- 广播执行引擎独立成可调用函数并支持注入 deliverer/sleep/retry 配置，handler 与 cron 共用同一套进度统计，临时冒烟脚本可用假 deliverer 验证成功/失败/跳过汇总，无需真实 Telegram API。
- 媒体广播与资源入库共用“转发媒体”入口，用说明前缀 `/bc` 区分，两条 `message:media` 处理器都要在不匹配时 `next()`，避免互相抢占；转发文本则默认立即广播。
- UTC 每月调度要小心 `Date` 的月末进位：计算目标月天数时用 `Date.UTC(year, month, 0)`（month 传自然月序号），否则 1 月 31 日的下月会算出 3 月 3 日；冒烟测试覆盖了该边界。
- `grammy` 根导出不含 `Message` 类型，需从 `grammy/types` 导入；`@grammyjs/types` v4 中转发消息只保留 `forward_origin`，不再有 `forward_date/forward_from` 公共字段。
## 任务 6 经验

- grammY 的 `cloudflare-mod` 适配器返回 `(request) => Promise<Response>`，不接收 env/ctx；webhook 入口需先用 `createBot(env)` 按当前请求注入 D1 与 waitUntil，再闭包挂载到 `webhookCallback`。
- `webhookCallback` 首次调用会改写 `bot.start` 并触发 `bot.init()`（getMe）；webhook secret 校验应放在调用前，否则 token 无效时 init 失败会先于 401 抛出。
- Worker 的 `ScheduledController` 只暴露 `cron` 表达式，没有独立触发器名称；入口按表达式映射到 `runDailyMaintenance` / `runBroadcastCron` / `runStatsPreaggregation`，并在 scheduled 外层统一 try/catch。
- 定时广播复用 `createTelegramDeliverer(bot.api)`，与管理员手工广播共用同一执行引擎；入口新增 `WEBHOOK_SECRET` 可选变量并加入共享 `Env` 类型。
