# ResourcesGetBot

Private resource sharing Telegram Bot based on aiogram 3.x + FastAPI + SQLite.

## Features
- `/start <short_code>` or send short_code in private chat to get resource
- Channel subscription check before downloading
- Auto-generated short codes for resources
- Rate limiting (max 10 downloads per 10 minutes)
- Multi-admin support (comma-separated user IDs)

### Admin Panel (FastAPI Web)
- Resource CRUD + new attributes (author, quality, mosaic, direction)
- User list with ban/unban
- Statistics dashboard (charts: daily registrations, downloads, active users)
- Broadcast messages (rich text HTML + media) to all users

### Bot Upload Flow
1. Admin sends video/photo/document to bot
2. Input: `-t Title -a Author -t Tag1 -t Tag2`
3. Select quality / mosaic / direction via inline buttons
4. Short code auto-generated, resource saved

## Directory Structure

```text
.
├── app/
│   ├── bot/
│   │   ├── handlers/     # admin.py, user.py, errors.py
│   │   ├── keyboards.py  # Inline keyboards
│   │   ├── services.py   # Core bot logic
│   │   └── states.py     # FSM states
│   ├── web/
│   │   ├── templates/    # Jinja2 templates
│   │   └── main.py       # FastAPI routes
│   ├── config.py         # Settings (.env)
│   ├── database.py       # DB connection + migration
│   ├── models.py         # SQLAlchemy models
│   └── repositories.py   # DB queries
├── main.py               # Bot entry point
├── web.py                # Web entry point
├── requirements.txt
└── .env.example
```

## Quick Start

### 1. Install dependencies
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Windows PowerShell:
```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Configure
```bash
cp .env.example .env
```
Edit `.env`:
- `BOT_TOKEN` - From BotFather
- `CHANNEL_ID` - e.g. `-1001234567890`
- `CHANNEL_URL` - Channel invite link
- `ADMIN_USER_ID` / `ADMIN_USER_IDS` - Admin Telegram user IDs (comma separated)
- `WEB_ADMIN_PASSWORD` - Change to a strong password
- `PROXY_URL` - Optional SOCKS5 proxy for Telegram API

### 3. Run
```bash
# Start Bot
python main.py

# Start Web Admin (separate terminal)
uvicorn web:app --host 0.0.0.0 --port 8000
```

Access `http://server-ip:8000/admin` and login with web admin credentials.

## systemd Deployment (Linux)

### Bot Service
`/etc/systemd/system/resources-bot.service`:
```ini
[Unit]
Description=ResourcesGetBot Telegram Bot
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/ResourcesGetBot
ExecStart=/opt/ResourcesGetBot/.venv/bin/python /opt/ResourcesGetBot/main.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

### Web Admin Service
`/etc/systemd/system/resources-web.service`:
```ini
[Unit]
Description=ResourcesGetBot Admin Web
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/ResourcesGetBot
ExecStart=/opt/ResourcesGetBot/.venv/bin/uvicorn web:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

### Nginx Reverse Proxy (Production)
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # IP restriction for admin panel
    location /admin {
        allow YOUR_FIXED_IP;
        deny all;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Enable Services
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now resources-bot resources-web
sudo systemctl status resources-bot resources-web

# View logs
sudo journalctl -u resources-bot -f
sudo journalctl -u resources-web -f
```

## Usage

### Admin: Upload Resource
1. Send video/photo/document to the bot
2. Bot asks for attributes, use format: `-t Title -a Author -t Tag1 -t Tag2`
3. Select quality (4K/1080+/1080P/720P/480P) via buttons
4. Select mosaic status (#有码/#无码/#无码修复)
5. Select direction (#竖屏/#横屏)
6. Short code auto-generated, resource saved

### User: Get Resource
- Send `/start <short_code>` or just `short_code` in private chat
- Bot checks channel subscription, shows subscribe button + "I've subscribed" check
- If not subscribed, user can click "I've subscribed" to re-check after joining
- Resource caption shows non-null attributes (author, tags, quality, mosaic, direction)

### Admin Panel
- `/admin` - Resource list with edit/delete
- `/admin/users` - User list with ban/unban
- `/admin/stats` - Charts: daily registrations, downloads, active users
- `/admin/broadcast` - Send rich text + media to all users

## Tech Stack
- Python 3.11+
- aiogram 3.x (Telegram Bot framework)
- FastAPI + Jinja2 + Chart.js (Web admin + charts)
- SQLAlchemy 2.x + aiosqlite (Database)
- SQLite (Database engine)
- uvicorn (ASGI server)
