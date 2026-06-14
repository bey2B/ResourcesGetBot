from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
import os
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _env_int(name: str, default: int | None = None) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        if default is None:
            raise ValueError(f"Missing required environment variable: {name}")
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc


def _env_str(name: str, default: str | None = None) -> str:
    raw = os.getenv(name)
    if raw is None or raw == "":
        if default is None:
            raise ValueError(f"Missing required environment variable: {name}")
        return default
    return raw


@dataclass(frozen=True)
class Settings:

    bot_token: str
    channel_id: str
    channel_url: str
    admin_user_id: int
    database_url: str
    web_admin_username: str
    web_admin_password: str
    rate_limit_window_seconds: int
    rate_limit_max_downloads: int
    proxy_url: str | None = None
    admin_user_ids: tuple[int, ...] = field(default_factory=tuple)

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(PROJECT_ROOT / ".env")
        return cls(
            bot_token=_env_str("BOT_TOKEN"),
            channel_id=_env_str("CHANNEL_ID"),
            channel_url=_env_str("CHANNEL_URL"),
            admin_user_id=_env_int("ADMIN_USER_ID"),
            database_url=_env_str("DATABASE_URL", "sqlite+aiosqlite:///./data/bot.db"),
            web_admin_username=_env_str("WEB_ADMIN_USERNAME", "admin"),
            web_admin_password=_env_str("WEB_ADMIN_PASSWORD", "change-me"),
            rate_limit_window_seconds=_env_int("RATE_LIMIT_WINDOW_SECONDS", 600),
            rate_limit_max_downloads=_env_int("RATE_LIMIT_MAX_DOWNLOADS", 10),
            proxy_url=os.getenv("PROXY_URL") or None,
            admin_user_ids=_parse_admin_ids(),
        )


def _parse_admin_ids() -> tuple[int, ...]:
    raw = os.getenv("ADMIN_USER_IDS", "") or ""
    if raw.strip():
        ids = [int(x.strip()) for x in raw.split(",") if x.strip()]
        return tuple(ids)
    return (_env_int("ADMIN_USER_ID"),)

@lru_cache(maxsize=1)
def get_settings() -> Settings:

    return Settings.from_env()

