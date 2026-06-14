from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import PROJECT_ROOT, get_settings


class Base(DeclarativeBase):
    pass


def _ensure_sqlite_parent(database_url: str) -> None:
    prefix = "sqlite+aiosqlite:///"
    if not database_url.startswith(prefix) or database_url.endswith(":memory:"):
        return

    raw_path = database_url.removeprefix(prefix)
    db_path = Path(raw_path) if raw_path.startswith("/") else PROJECT_ROOT / raw_path
    db_path.parent.mkdir(parents=True, exist_ok=True)


settings = get_settings()
_ensure_sqlite_parent(settings.database_url)

engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    pool_pre_ping=True,
)

async_session = async_sessionmaker(
    engine,
    expire_on_commit=False,
    autoflush=False,
    class_=AsyncSession,
)


async def init_db() -> None:
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Migration: add new columns for older databases
        await _migrate_schema(conn)


async def _migrate_schema(conn) -> None:
    from sqlalchemy import text
    migrations = [
        ("ALTER TABLE resources ADD COLUMN author VARCHAR(255)",
         "author"),
        ("ALTER TABLE resources ADD COLUMN quality VARCHAR(32)",
         "quality"),
        ("ALTER TABLE resources ADD COLUMN mosaic_status VARCHAR(64)",
         "mosaic_status"),
        ("ALTER TABLE resources ADD COLUMN video_direction VARCHAR(32)",
         "video_direction"),
        ("ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0",
         "is_banned"),
    ]
    for stmt, col_name in migrations:
        try:
            await conn.execute(text(stmt))
            import logging
            logging.getLogger(__name__).info("Schema migration: added column %s", col_name)
        except Exception:
            pass  # Column already exists


async def get_session() -> AsyncIterator[AsyncSession]:
    async with async_session() as session:
        yield session

