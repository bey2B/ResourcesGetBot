from __future__ import annotations

from datetime import datetime, timedelta

from aiogram.types import User as TelegramUser
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DownloadLog, Resource, User, utc_now


async def upsert_user(session: AsyncSession, telegram_user: TelegramUser) -> User:
    result = await session.execute(select(User).where(User.user_id == telegram_user.id))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(
            user_id=telegram_user.id,
            username=telegram_user.username or "",
            first_name=telegram_user.first_name or "",
        )
        session.add(user)
    else:
        user.username = telegram_user.username or ""
        user.first_name = telegram_user.first_name or ""
        user.last_seen_at = utc_now()
    await session.flush()
    return user


async def get_resource_by_code(session: AsyncSession, short_code: str) -> Resource | None:
    result = await session.execute(
        select(Resource).where(Resource.short_code == short_code.strip())
    )
    return result.scalar_one_or_none()


async def get_resource(session: AsyncSession, resource_id: int) -> Resource | None:
    return await session.get(Resource, resource_id)


async def list_resources(session: AsyncSession) -> list[Resource]:
    result = await session.execute(select(Resource).order_by(Resource.created_at.desc()))
    return list(result.scalars().all())


async def create_resource(
    session: AsyncSession,
    *,
    short_code: str,
    title: str,
    tags: str,
    file_id: str,
    file_type: str,
    caption: str,
    created_by: int,
    author: str | None = None,
    quality: str | None = None,
    mosaic_status: str | None = None,
    video_direction: str | None = None,
) -> Resource:
    resource = Resource(
        short_code=short_code.strip(),
        title=title.strip(),
        tags=tags.strip(),
        file_id=file_id.strip(),
        file_type=file_type.strip(),
        caption=caption.strip(),
        created_by=created_by,
        author=author.strip() if author else None,
        quality=quality,
        mosaic_status=mosaic_status,
        video_direction=video_direction,
    )
    session.add(resource)
    await session.flush()
    return resource


async def update_resource(
    session: AsyncSession,
    resource: Resource,
    *,
    short_code: str,
    title: str,
    tags: str,
    file_id: str,
    file_type: str,
    caption: str,
    author: str | None = None,
    quality: str | None = None,
    mosaic_status: str | None = None,
    video_direction: str | None = None,
) -> Resource:
    resource.short_code = short_code.strip()
    resource.title = title.strip()
    resource.tags = tags.strip()
    resource.file_id = file_id.strip()
    resource.file_type = file_type.strip()
    resource.caption = caption.strip()
    resource.author = author.strip() if author else None
    resource.quality = quality
    resource.mosaic_status = mosaic_status
    resource.video_direction = video_direction
    resource.updated_at = utc_now()
    await session.flush()
    return resource


async def delete_resource(session: AsyncSession, resource_id: int) -> None:
    await session.execute(delete(Resource).where(Resource.id == resource_id))
    await session.flush()


async def list_users(session: AsyncSession) -> list[User]:
    result = await session.execute(select(User).order_by(User.joined_at.desc()))
    return list(result.scalars().all())


async def count_recent_downloads(
    session: AsyncSession,
    *,
    user_id: int,
    since: datetime,
) -> int:
    result = await session.execute(
        select(func.count(DownloadLog.id)).where(
            DownloadLog.user_id == user_id,
            DownloadLog.created_at >= since,
        )
    )
    return int(result.scalar_one())


async def get_total_users(session: AsyncSession) -> int:
    result = await session.execute(select(func.count(User.user_id)))
    return result.scalar_one() or 0


async def get_daily_user_registrations(session: AsyncSession, days: int = 30) -> list[dict]:
    since = utc_now() - timedelta(days=days)
    rows = await session.execute(
        text("SELECT DATE(joined_at) as date, COUNT(*) as count FROM users WHERE joined_at >= :since GROUP BY date ORDER BY date"),
        {"since": since}
    )
    return [{"date": str(r[0]), "count": r[1]} for r in rows.all()]


async def get_daily_downloads(session: AsyncSession, days: int = 30) -> list[dict]:
    since = utc_now() - timedelta(days=days)
    rows = await session.execute(
        text("SELECT DATE(created_at) as date, COUNT(*) as count FROM download_logs WHERE created_at >= :since GROUP BY date ORDER BY date"),
        {"since": since}
    )
    return [{"date": str(r[0]), "count": r[1]} for r in rows.all()]


async def get_daily_active_users(session: AsyncSession, days: int = 30) -> list[dict]:
    since = utc_now() - timedelta(days=days)
    rows = await session.execute(
        text("SELECT DATE(created_at) as date, COUNT(DISTINCT user_id) as count FROM download_logs WHERE created_at >= :since GROUP BY date ORDER BY date"),
        {"since": since}
    )
    return [{"date": str(r[0]), "count": r[1]} for r in rows.all()]


async def ban_user(session: AsyncSession, user_id: int) -> User | None:
    result = await session.execute(select(User).where(User.user_id == user_id))
    user = result.scalar_one_or_none()
    if user:
        user.is_banned = True
        await session.flush()
    return user


async def unban_user(session: AsyncSession, user_id: int) -> User | None:
    result = await session.execute(select(User).where(User.user_id == user_id))
    user = result.scalar_one_or_none()
    if user:
        user.is_banned = False
        await session.flush()
    return user


async def get_all_user_ids(session: AsyncSession) -> list[int]:
    result = await session.execute(select(User.user_id).where(User.is_banned == 0))
    return [r[0] for r in result.all()]


async def count_online_users(session: AsyncSession, minutes: int = 5) -> int:
    since = utc_now() - timedelta(minutes=minutes)
    result = await session.execute(
        select(func.count(User.user_id)).where(User.last_seen_at >= since)
    )
    return result.scalar_one() or 0


async def log_download(session: AsyncSession, *, user: User, resource: Resource) -> None:
    session.add(DownloadLog(user_id=user.user_id, resource_id=resource.id))
    user.download_count += 1
    user.last_seen_at = utc_now()
    await session.flush()

