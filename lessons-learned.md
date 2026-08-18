
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

## 任务 U1 经验

- 本机首次 `npm run db:local` 可能长时间无输出（wrangler 更新检查/本地锁），超时后会残留 node/wrangler 进程；先确认并结束残留进程（命令行为 `wrangler d1 execute ...`），再设置 `WRANGLER_SEND_METRICS=false` 重试，第二次执行会明显变快。
- 新表全部使用 `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` 即可让 `schema.sql` 对已有本地 D1 重复执行；避免对已有表做 `ALTER TABLE`，否则非幂等。
- 广告按钮与旧 `file_ids` 一样用 JSON 文本列存储（`buttons TEXT DEFAULT '[]'`），读取时再解析成 `{text, url}[]`，避免为按钮单独建表增加 JOIN 复杂度。
- 本地冒烟新查询可直接用 Node 22 的 `node:sqlite`（`DatabaseSync`）执行 `schema.sql`，再包一个最小 D1 适配器（`prepare/bind/run/first/all/batch`）传给 queries.ts，无需真实 wrangler dev；临时脚本验证后删除。

## 任务 U2 经验

- grammY 的 `bot.callbackQuery('data', handler)` 会按回调数据精确匹配；带状态机的处理器要注册在既有 `message:media` / `message:text` 处理器之前才能优先接管，不匹配时必须 `next()` 放行，避免抢占签到、短码、广播等下游流程。
- 管理员媒体入库与“资源存储收集”共用 `message:media` 入口时，按会话状态分流：有会话则收集后返回，无会话再 `next()` 走原有广播/自动入库，避免两个处理器互相抢占或重复入库。
- 转发/直发消息的媒体提取复用 `extractMediaFromMessage` 即可覆盖 photo/video/document/audio/animation 等类型，`media_type` 随 `file_id` 一起写入 `resource_files`，为后续 U3 按类型发送做准备。
- 内存会话 Map 以管理员 `user_id` 为 key 即可天然隔离多管理员；非管理员入口统一走 `requireAdmin` 拒绝，文本/媒体处理器在无会话时不调用 `requireAdmin` 的拒绝分支，避免给普通用户新增“无权限”回复。

## 任务 U3 经验

- `resource_files.media_type` 必须在创建/更新资源时随 `file_id` 一起写入（`ResourceCreateInput.files` / `ResourceUpdateInput.files`），否则 album 模式无法区分 photo/video，旧数据只能按未知类型逐条兜底发送。
- grammY 的 `InputMediaBuilder.photo/video` 返回值可直接传给 `api.sendMediaGroup`；album 分组保持 sort_order 连续顺序、每块最多 10 条，遇到 document/audio 等非相册类型先 flush 再单独发送，单文件不分组。
- 投递服务统一提供 `deliverResource(api, chatId, resource, { db, mode?, caption? })`，显式 mode 可绕过 settings 查询，方便 U5 `/purchases` 点击发送直接复用；返回 `messageIds` 供群组自动删除使用。
- `npm run build` 里的 `npm --prefix admin install` 在 `admin/node_modules` 已存在指向根目录的 `cua-super-bot` junction 时，会把 `"cua-super-bot": "file:.."` 写回 `admin/package.json` 与 `admin/package-lock.json`；构建成功后需对照 git 确认这两个文件未产生无关依赖改动。

## 任务 U4 经验

- 广告位独立消息应在资源投递前/后分别发送，并把返回的 message_id 并入 `handleResourceRequest` 的 messageIds，保证群组自动删除同时清理广告。
- 广告发送失败不应阻断资源投递：独立发送包 try/catch 记录日志即可；媒体类型未知或发送失败时复用 delivery 风格的多类型兜底。
- `ad_messages.buttons` 用 JSON 数组存储，`setAdMessageButtons` 的 INSERT 只有 4 个绑定参数（ad_id、buttons、created_at、updated_at），冒烟 mock 需按绑定数量区分 upsert。

## 任务 U5 经验

- `/purchases` 分页列表复用 U1 的 `listPurchasedResources` / `countPurchasedResources`，并在两处查询都加上 `r.is_paid = 1`，保证免费资源即使存在历史 purchases 记录也不会出现在列表中。
- 分页回调与资源获取回调分别使用 `purchases:page:{userId}:{page}` 和 `purchase:get:{userId}:{resourceId}`，回调数据内嵌列表所属 userId，处理时与 `callbackQuery.from.id` 比对即可防串扰。
- 冒烟验证用内存 D1 mock 覆盖 count/list/getResource/hasPurchased/settings 查询，并 mock `ctx.reply`、`ctx.editMessageText`、`ctx.answerCallbackQuery` 与 API 发送方法，可直接断言第 1/3、中间、末页标题按钮、每页 10 条、翻页编辑同一条消息与点击投递。

## 任务 U6 经验

- 广播二次确认用进程内草稿 Map 按管理员 user_id 隔离，状态机分为 `awaiting_message` → `awaiting_confirm` → `awaiting_schedule`，入口文案把 `xxx` 用 `countUsers` 结果替换；回调数据统一用 `broadcast:` 前缀避免与资源存储/广告配置冲突。
- 带状态机的 `/cancel`、文本/媒体接管处理器必须注册在资源存储等既有 `message:text` / `message:media` 处理器之前，未命中时全部 `next()` 放行，避免抢占签到、短码、资源入库等下游流程；命令类文本在草稿状态下交给既有命令处理器，避免把 `/bc` 等命令当广播内容。
- 冒烟验证可直接用 `createBot(env)` + `bot.middleware()`，手工构造 `BotContext(update, mockApi, botInfo)` 驱动回调与消息更新；后台广播用注入的 `waitUntil` 收集 Promise 后 `await Promise.all(...)`，即可在无真实 Telegram API 的情况下验证执行完成后的进度报告。

## 任务 U7 经验

- 管理后台 API 冒烟可直接用 `node:sqlite` 的 `DatabaseSync` 包一层最小 D1 适配器（`prepare/bind/run/first/all/batch`），再调用 `handleAdminApi` + `signAdminToken` 验证 settings PATCH、广告按钮保存等真实请求路径，无需启动 wrangler 或读取 `.dev.vars`。
- 前端 `client.ts` 的字符串/对象 `error` 兼容可用 `esbuild` 打包（`define: { 'import.meta.env': '{}' }`）后在 Node 中 stub `fetch/localStorage/window` 直接跑真实 `api.get`，避免为私有函数额外导出测试入口。

## 任务 U8 经验

- 本机 npm 在“父项目目录含 package.json + `npm --prefix <子目录> install`”时会自动把父项目写成 `file:..` 依赖；根目录 build 脚本应改为 `cd admin && npm install && npm run build`。清理自引用时还要删掉 `admin/node_modules/.package-lock.json` 与 `admin/package-lock.json` 后重新生成，否则 npm 会从旧锁/链接状态把自引用写回。
- 本机 wrangler 4.120 的 `deploy --dry-run` 会打印 `--dry-run: exiting now.` 但进程因 `exitProcess(false)` 不退出；构建脚本用 `scripts/wrangler-dry-run.mjs` 子进程包装，检测到完成标记后结束子进程即可。超时残留的 wrangler/workerd 进程会锁住 `.wrangler` 本地状态，重跑 `db:local` 前必须先清理。
