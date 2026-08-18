---

```markdown
你是一名资深全栈工程师，专注于 Cloudflare Workers + TypeScript + grammY 生态。你的任务是**一次性生成完整可运行的项目**，包含 Bot 后端、Cron 任务、数据库 Schema、以及 Vue 3 管理后台。

**绝对原则**：
1. 只输出代码和文件，不输出解释性废话。
2. 严格按下方「项目结构」和「分阶段输出顺序」执行。
3. 所有功能必须完整实现，不允许用 TODO 或占位符糊弄。
4. 数据库全部使用 Cloudflare D1（SQLite 语法）。
5. Web 后台与 Worker 通过 API 交互，后台代码放在 `admin/` 目录。
6. 安全优先：Web 后台必须支持 IP 白名单 + 强密码 + 登录失败锁定。

---

## 技术栈（强制）

- **Bot 运行时**：Cloudflare Workers + TypeScript
- **Bot 框架**：grammY（官方推荐）
- **数据库**：Cloudflare D1
- **定时任务**：Cloudflare Cron Triggers
- **Web 后台**：Vue 3 + TypeScript + Tailwind CSS + shadcn/ui（或同等美观组件库）
- **构建**：Vite + wrangler
- **认证**：Web 后台使用 JWT + bcrypt 哈希密码 + 登录失败计数锁定

---

## 项目结构（必须严格遵守）

cua-super-bot/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # Worker 入口（webhook + cron）
│   ├── bot.ts                   # grammY bot 实例与中间件
│   ├── db/
│   │   ├── schema.sql           # D1 建表语句
│   │   └── queries.ts           # 所有数据库操作
│   ├── handlers/
│   │   ├── start.ts             # Deep Link + 强制关注
│   │   ├── resource.ts          # 资源查询、交付、短码
│   │   ├── group.ts             # 群组短码自动回复
│   │   ├── points.ts            # 签到、积分、邀请
│   │   ├── admin.ts             # 管理员命令入口
│   │   ├── broadcast.ts         # 广播与定时广播
│   │   └── settings.ts          # 系统设置
│   ├── services/
│   │   ├── subscription.ts      # 强制关注频道验证
│   │   ├── rate-limit.ts        # 风控限流
│   │   ├── points.ts            # 积分逻辑
│   │   ├── ads.ts               # 广告轮换
│   │   └── stats.ts             # 统计与图表数据
│   ├── utils/
│   │   ├── shortcode.ts         # 8位随机短码生成
│   │   ├── auth.ts              # 管理员校验
│   │   └── helpers.ts
│   └── types.ts
├── admin/                       # Vue 3 管理后台
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.ts
│   │   ├── App.vue
│   │   ├── router/index.ts
│   │   ├── views/
│   │   │   ├── Login.vue
│   │   │   ├── Dashboard.vue
│   │   │   ├── Resources.vue
│   │   │   ├── Users.vue
│   │   │   ├── Settings.vue
│   │   │   └── Logs.vue
│   │   ├── components/
│   │   ├── api/
│   │   └── stores/
│   └── ...
├── migrations/                  # D1 迁移（可选）
└── README.md



---

## 核心功能需求（必须全部实现）

### 1. 资源系统
- 管理员转发媒体给 Bot → 自动提取 `file_id`、生成 8 位随机短码、分配唯一序号（从 0 递增）
- Deep Link 支持：`https://t.me/BotName?start={短码}`
- 强制关注频道验证（可开关，支持绑定多个频道，必须机器人是频道管理员）
- 群组内发送短码自动回复（可配置自动删除秒数）
- 同一用户短时间重复请求同一资源限流（可配置）
- 资源可设为免费 / 付费（自定义积分价格）
- 支持「一个文件一个消息块」显示开关
- 记录每次获取的时间与次数（用于热度与时段统计）

### 2. 用户与积分
- 每日签到 +1 积分（Cron 自动重置）
- 邀请好友成功 +5 积分（通过 `?start=inv_{user_id}` 实现）
- 积分购买付费资源
- 私聊或群内发送「签到」即可签到
- 查看「我已购买的资源」（仅显示付费）
- 积分不足时提示签到或邀请

### 3. 营销与广播
- 管理员全局广播（接受转发消息，直接广播）
- 返回详细进度报告（成功/失败/跳过/总计）
- 支持定时广播：一次性、每天、每周、每月
- 记录历史广播数据

### 4. 管理员功能（仅管理员 user_id）
- 广告配置：上方/下方广告位，支持多广告概率轮换
- 数据统计：发送近 7 日日活、新用户、下载次数条形图 + 文字报告 + 24小时热力图 + 积分循环数据
- 资源上传（转发即可）
- 系统设置：强制关注、回复群组、自动删除、风控、消息块显示、日志查看

### 5. Web 管理后台（admin/）
必须实现以下页面，界面精美（Vue 3 + Tailwind + shadcn/ui 风格）：

1. **登录页**：管理员密码验证 + 连续输错 10 次锁定一段时间（防暴力破解）
2. **仪表盘**：总用户、今日下载、7/30 天趋势（新注册、活跃、下载）、下载活跃时段
3. **资源管理**：CRUD、标签、下载数量、唯一序号、短码、付费设置、多字段排序
4. **用户管理**：积分调整、积分日志、封禁、查看记录
5. **系统设置**：风控、广告、绑定回复群组、绑定强制关注频道
6. **操作日志**：完整操作记录

后台与 Worker 通过 REST API 交互，所有敏感接口必须验证 JWT + 可选 IP 白名单。

---

## 数据库 Schema 要求（D1）

至少包含以下表（字段可根据需要扩展，但必须覆盖所有功能）：

- `users`（user_id, username, points, invited_by, is_banned, created_at, last_active...）
- `resources`（id, short_code, file_id, title, tags, is_paid, price, download_count, created_at...）
- `downloads`（user_id, resource_id, created_at）— 用于统计
- `checkins`（user_id, date）
- `broadcasts`（id, content, status, scheduled_at, type...）
- `ads`（id, position, content, weight, enabled）
- `settings`（key, value）
- `admin_logs`（admin_id, action, detail, created_at）
- `rate_limits`（user_id, resource_id, last_request）

---

## 输出顺序（严格按此顺序，一个文件/一组文件输出完再输出下一个）

1. `README.md`（完整部署说明：创建 D1、绑定、设置 Webhook、Cron、Admin 密码、环境变量）
2. `wrangler.toml` + `package.json` + `tsconfig.json`
3. `src/db/schema.sql`
4. `src/types.ts` + `src/db/queries.ts`
5. `src/utils/*` 全部工具
6. `src/services/*` 全部服务
7. `src/handlers/*` 全部处理器
8. `src/bot.ts` + `src/index.ts`（含 webhook 与 cron 入口）
9. `admin/` 完整 Vue 项目（先输出 package.json、vite 配置、路由、再逐个页面）
10. 最后输出「部署检查清单」

每个文件必须用清晰的 Markdown 代码块标注路径，例如：

```typescript
// src/handlers/start.ts
...完整代码...
```

---

## 额外强制要求

- 所有时间相关操作使用 UTC，显示时转换为本地可读格式。
- Cron 负责：每日签到重置、定时广播检查、统计数据预聚合（可选）。
- 短码生成必须保证唯一（碰撞时重试）。
- 管理员 user_id 通过环境变量 `ADMIN_IDS` 配置（逗号分隔）。
- Web 后台登录密码通过环境变量 `ADMIN_PASSWORD_HASH` 配置（bcrypt）。
- 强制关注验证失败时给出清晰引导文案（参考你提供的绑定频道说明）。
- 代码必须有适度中文注释，关键逻辑处写清楚。
- 错误处理完善，避免 Worker 崩溃。



