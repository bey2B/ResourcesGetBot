# ResourcesGetBot MVP

一个基于 aiogram 3.x、SQLAlchemy 2.x、SQLite 和 FastAPI 的私密资源分享 Bot MVP。

## 功能

- 用户通过 `/start 短码` 或私聊发送短码获取资源。
- 每次获取资源前都会检查是否已关注指定频道。
- 10 分钟最多下载 10 个资源，主要用于拦截脚本化批量请求。
- 管理员发送视频、图片、文档给 Bot 后，通过短码和标签保存资源。
- FastAPI Web 后台支持资源新增、编辑、删除和用户列表查看。

## 目录结构

```text
.
├── app/
│   ├── bot/
│   │   ├── handlers/
│   │   │   ├── admin.py
│   │   │   ├── errors.py
│   │   │   └── user.py
│   │   ├── keyboards.py
│   │   ├── services.py
│   │   └── states.py
│   ├── web/
│   │   ├── templates/
│   │   │   ├── base.html
│   │   │   ├── resource_form.html
│   │   │   ├── resources.html
│   │   │   └── users.html
│   │   └── main.py
│   ├── config.py
│   ├── database.py
│   ├── models.py
│   └── repositories.py
├── main.py
├── web.py
├── requirements.txt
└── .env.example
```

## 快速开始

1. 创建虚拟环境并安装依赖：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Windows PowerShell：

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. 创建配置：

```bash
cp .env.example .env
```

填写：

- `BOT_TOKEN`：从 BotFather 获取。
- `CHANNEL_ID`：频道 ID，例如 `-1001234567890`。Bot 必须能读取该频道成员状态，通常建议设为频道管理员。
- `CHANNEL_URL`：关注按钮跳转链接。
- `ADMIN_USER_ID`：允许添加资源的 Telegram 用户 ID。
- `WEB_ADMIN_PASSWORD`：务必改成强密码。

3. 启动 Bot：

```bash
python main.py
```

4. 启动后台：

```bash
uvicorn web:app --host 0.0.0.0 --port 8000
```

访问 `http://服务器IP:8000/admin`，使用 `.env` 中的后台账号密码登录。

## 使用方式

管理员私聊 Bot 发送或转发视频、图片、文档。Bot 读取媒体后，会提示输入：

```text
b0942703 #清纯 #日本 #有码
```

保存成功后，用户可以：

```text
/start b0942703
```

或直接私聊发送：

```text
b0942703
```

## systemd 部署示例

`/etc/systemd/system/resources-bot.service`：

```ini
[Unit]
Description=ResourcesGetBot Telegram Bot
After=network.target

[Service]
WorkingDirectory=/opt/ResourcesGetBot
ExecStart=/opt/ResourcesGetBot/.venv/bin/python /opt/ResourcesGetBot/main.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/resources-web.service`：

```ini
[Unit]
Description=ResourcesGetBot Admin Web
After=network.target

[Service]
WorkingDirectory=/opt/ResourcesGetBot
ExecStart=/opt/ResourcesGetBot/.venv/bin/uvicorn web:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now resources-bot resources-web
sudo systemctl status resources-bot resources-web
```

生产环境建议用 Nginx 反代后台，并限制管理后台访问 IP。



