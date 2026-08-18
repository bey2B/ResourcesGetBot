# Cua 超级助手 Telegram Bot

基于 Cloudflare Workers + TypeScript + grammY + D1 的 Telegram 资源分发机器人，附带完整的 Vue 3 管理后台（`admin/`）。

## 技术栈

- Bot 运行时：Cloudflare Workers + TypeScript
- Bot 框架：grammY
- 数据库：Cloudflare D1（SQLite 语法）
- 定时任务：Cloudflare Cron Triggers
- 管理后台：Vue 3 + TypeScript + Tailwind CSS + shadcn/ui（或同等美观组件库）

## 目录结构

```text
cua-super-bot/
├── wrangler.toml          # Worker 配置：D1 绑定、Cron、环境变量
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           # Worker 入口：webhook + cron 挂载点
│   ├── bot.ts             # grammY bot 实例
│   ├── db/                # schema.sql + queries.ts
│   ├── handlers/          # Bot 命令/消息处理器
│   ├── services/          # 业务逻辑服务
│   ├── utils/             # 工具函数
│   └── types.ts           # 共享类型
├── admin/                 # Vue 3 管理后台
├── migrations/            # D1 迁移 SQL
└── README.md
```

## 入口路由

| 路径 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/webhook` | POST | Telegram Webhook |
| 其他路径 | 任意 | 404 |
| `/`、`/health`、`/webhook` | 非预期方法 | 405 |

## 环境要求

- Node.js >= 20
- npm
- Cloudflare 账号，并先执行 `npx wrangler login`

## 本地开发

```bash
npm install
npm run dev
```

## 管理后台（admin/）

管理后台为独立 Vue 3 项目，位于 `admin/`，通过 `/api/admin` 与 Worker 交互（登录后使用 `Authorization: Bearer <token>`）。

```bash
cd admin
npm install
npm run dev        # http://127.0.0.1:5173，/api 代理到 127.0.0.1:8787
npm run build      # 类型检查 + 产物输出到 admin/dist/
```

生产部署时构建 `admin/dist/` 并托管静态文件，通过反向代理或 Worker 静态资源路由将 `/api/admin` 指向同一 Worker；如需指定其他 API 地址，可在 `admin/.env.local` 设置 `VITE_API_BASE`。详细说明见 [admin/README.md](./admin/README.md)。

启动后访问 `http://127.0.0.1:8787/health` 验证健康检查。本地敏感变量写入 `.dev.vars`（已被 `.gitignore` 忽略）：

```text
BOT_TOKEN=123456:ABCDEF
ADMIN_IDS=123456789,987654321
ADMIN_PASSWORD_HASH=$2b$12$xxxxxxxxxxxxxxxxxxxxxx
WEBHOOK_SECRET=change-me
```

## 部署步骤

### 1. 创建 D1 数据库

```bash
npx wrangler d1 create cua-super-bot-db
```

将命令输出的 `database_id` 填入 [wrangler.toml](./wrangler.toml) 中 `[[d1_databases]]` 的 `database_id`，替换占位 UUID。

### 2. 应用数据库 Schema

```bash
npm run db:local      # 应用到本地 D1
npm run db:migrate    # 通过 migrations/ 目录应用到远程 D1
```

### 3. 配置环境变量

敏感变量一律使用 `wrangler secret put`，不要提交到仓库：

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put ADMIN_IDS
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put WEBHOOK_SECRET
```

变量说明：

| 变量 | 必填 | 说明 |
|------|------|------|
| `BOT_TOKEN` | 是 | Telegram Bot Token，由 BotFather 提供 |
| `ADMIN_IDS` | 是 | 管理员 Telegram user_id，逗号分隔 |
| `ADMIN_PASSWORD_HASH` | 是 | 管理后台登录密码的 bcrypt 哈希 |
| `WEBHOOK_SECRET` | 否 | Webhook 校验密钥，需与 setWebhook 的 `secret_token` 一致 |
| `ADMIN_IP_WHITELIST` | 否 | 后台 API 可选 IP 白名单，逗号分隔的 IP/CIDR |
| `JWT_SECRET` | 是 | 管理后台 JWT 签名密钥，未配置时后台登录不可用 |
| `ADMIN_CORS_ORIGIN` | 否 | 后台 API 允许的跨域来源，默认 *（生产建议配置具体域名） |

生成 bcrypt 哈希示例：

```bash
npx bcrypt-cli hash "你的强密码"
```

注意：`wrangler.toml` 的 `[vars]` 仅为占位，`wrangler secret` 的值优先级高于 `[vars]` 同名项。

### 4. 配置 Cron Triggers

`wrangler.toml` 已启用以下触发器：

| 表达式 | 任务 |
|--------|------|
| `0 0 * * *` | 每日 UTC 00:00 清理过期签到与限流记录（签到按日期天然去重） |
| `*/15 * * * *` | 每 15 分钟检查并执行到期的定时广播 |
| `30 0 * * *` | 每日 UTC 00:30 预聚合统计快照，避开 0 点维护任务 |

所有时间相关操作均使用 UTC。

### 5. 部署 Worker

```bash
npm run build
npm run deploy
```

### 6. 设置 Telegram Webhook

配置了 `WEBHOOK_SECRET` 时：

```bash
curl -F "url=https://<your-worker>.workers.dev/webhook" -F "secret_token=<WEBHOOK_SECRET>" "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook"
```

未配置 `WEBHOOK_SECRET` 时：

```bash
curl -F "url=https://<your-worker>.workers.dev/webhook" "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook"
```

查询或删除 Webhook：

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
curl "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook"
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 本地启动 `wrangler dev` |
| `npm run typecheck` | TypeScript 严格类型检查 |
| `npm run build` | 类型检查 + wrangler 打包校验 |
| `npm run deploy` | 部署到 Cloudflare Workers |
| `npm run db:local` | 将 schema 应用到本地 D1 |
| `npm run db:migrate` | 应用 `migrations/` 中的远程迁移 |

## 健康检查

`GET /health` 返回：

```json
{"ok":true,"service":"cua-super-bot","time":"2026-08-09T00:00:00.000Z"}
```
