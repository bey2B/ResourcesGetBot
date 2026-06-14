# ResourcesGetBot 项目指南

## 项目概述
基于 aiogram 3.x + FastAPI + SQLite 的 Telegram 私密资源分享 Bot。
管理员可以通过 Bot 上传视频/图片/文档，自动生成短码，用户获取时需先关注频道。

## 核心文件
- `main.py` — Bot 主进程入口
- `web.py` — FastAPI Web 后台入口
- `app/config.py` — 配置读取
- `app/database.py` — 数据库连接与迁移
- `app/models.py` — 数据库模型
- `app/repositories.py` — 数据库查询层
- `app/bot/services.py` — Bot 核心业务逻辑
- `app/bot/handlers/` — Bot 消息处理
- `app/web/main.py` — Web 后台路由
- `app/web/templates/` — Jinja2 模板

## 常见操作

### 启动服务
- Bot: `.venv/bin/python main.py`
- Web: `.venv/bin/uvicorn web:app --host 0.0.0.0 --port 8000`

### 数据库迁移
自动在启动时执行（init_db 中的 ALTER TABLE）

### 配置文件
`.env` 文件中配置所有参数。关键字段：
- `BOT_TOKEN` — Telegram Bot Token
- `CHANNEL_ID` — 关注检查的频道 ID
- `ADMIN_USER_ID` / `ADMIN_USER_IDS` — 管理员用户 ID
- `WEB_ADMIN_PASSWORD` — 后台登录密码

### Web 后台路由
- `/admin` — 资源列表
- `/admin/users` — 用户列表（封禁/解封）
- `/admin/stats` — 统计
- `/admin/broadcast` — 广播
- `/admin/resources/new` — 新增资源
- `/admin/stats/data` — 统计 API
- `/admin/users/{id}/ban` — 封禁 API
- `/admin/users/{id}/unban` — 解封 API

## 注意事项
- 登录用 HTTP Basic Auth
- 广播直接用 Bot Token 创建临时 Bot 实例，需确保网络可访问 Telegram API
- 广播支持媒体（photo/video/document）+ 富文本（HTML）
- 用户被封禁后无法获取任何资源
- 数据库默认为 SQLite，路径在 data/bot.db
