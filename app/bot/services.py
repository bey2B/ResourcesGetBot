from __future__ import annotations

from datetime import timedelta
import logging
import re

from aiogram import Bot
from aiogram.enums import ChatMemberStatus
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError
from aiogram.types import Message
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.keyboards import subscribe_keyboard
from app.config import get_settings
from app.models import Resource, utc_now
from app.repositories import (
    count_recent_downloads,
    get_resource_by_code,
    log_download,
    upsert_user,
)


logger = logging.getLogger(__name__)
SHORT_CODE_RE = re.compile(r"^[A-Za-z0-9_-]{3,64}$")


async def is_channel_member(bot: Bot, user_id: int) -> bool:
    settings = get_settings()
    try:
        member = await bot.get_chat_member(settings.channel_id, user_id)
    except (TelegramBadRequest, TelegramForbiddenError) as exc:
        logger.warning("Failed to check channel membership for %s: %s", user_id, exc)
        return False

    if member.status in {
        ChatMemberStatus.CREATOR,
        ChatMemberStatus.ADMINISTRATOR,
        ChatMemberStatus.MEMBER,
    }:
        return True
    if member.status == ChatMemberStatus.RESTRICTED:
        return bool(getattr(member, "is_member", False))
    return False


async def send_subscribe_prompt(message: Message, short_code: str) -> None:
    settings = get_settings()
    await message.answer(
        f'<i>\u60a8\u9700\u8981\u52a0\u5165\u4ee5\u4e0b\u9891\u9053\u624d\u80fd\u4f7f\u7528</i>\n'
        f'<a href=\"{settings.channel_url}\">喜欢看清纯洁白的素人</a>',
        reply_markup=subscribe_keyboard(short_code),
    )


async def is_rate_limited(session: AsyncSession, user_id: int) -> bool:
    settings = get_settings()
    since = utc_now() - timedelta(seconds=settings.rate_limit_window_seconds)
    recent_count = await count_recent_downloads(session, user_id=user_id, since=since)
    return recent_count >= settings.rate_limit_max_downloads


def build_resource_caption(resource: Resource) -> str:
    lines = []
    if resource.title:
        lines.append(f"\u6807\u9898/Title\uff1a{resource.title}")
    if resource.author:
        lines.append(f"\u4f5c\u8005/Author\uff1a#{resource.author}")
    if resource.tags:
        # Ensure tags have # prefix, split by space
        tag_list = resource.tags.split()
        tagged = []
        for t in tag_list:
            if not t.startswith("#"):
                t = "#" + t
            tagged.append(t)
        lines.append(f"TAG\uff1a{' '.join(tagged)}")
    if resource.quality:
        lines.append(f"\u6e05\u6670\u5ea6/\u8d28\u91cf/Quality\uff1a{resource.quality}")
    if resource.mosaic_status:
        val = resource.mosaic_status
        if not val.startswith("#"):
            val = "#" + val
        lines.append(f"\u9a6c\u8d5b\u514b/Reviewed\uff1a{val}")
    if resource.video_direction:
        val = resource.video_direction
        if not val.startswith("#"):
            val = "#" + val
        lines.append(f"\u89c6\u9891\u65b9\u5411/Video Direction\uff1a{val}")
    return "\n".join(lines)


async def send_resource(bot: Bot, chat_id: int, resource: Resource) -> None:
    caption = build_resource_caption(resource)
    if resource.file_type == "photo":
        await bot.send_photo(chat_id=chat_id, photo=resource.file_id, caption=caption)
    elif resource.file_type == "video":
        await bot.send_video(chat_id=chat_id, video=resource.file_id, caption=caption)
    elif resource.file_type == "document":
        await bot.send_document(chat_id=chat_id, document=resource.file_id, caption=caption)
    else:
        raise ValueError(f"Unsupported resource file type: {resource.file_type}")


async def handle_resource_request(
    *,
    message: Message,
    bot: Bot,
    session: AsyncSession,
    short_code: str,
) -> None:
    if message.from_user is None:
        return

    short_code = short_code.strip()
    if not SHORT_CODE_RE.fullmatch(short_code):
        await message.answer("\u77ed\u7801\u683c\u5f0f\u4e0d\u6b63\u786e\uff0c\u8bf7\u68c0\u67e5\u540e\u91cd\u8bd5\u3002")
        return

    user = await upsert_user(session, message.from_user)
    if user.is_banned:
        await session.commit()
        await message.answer("\u4f60\u5df2\u88ab\u5c01\u7981\uff0c\u65e0\u6cd5\u4f7f\u7528\u672c\u673a\u5668\u4eba\u3002")
        return

    resource = await get_resource_by_code(session, short_code)
    if resource is None:
        await session.commit()
        await message.answer("\u6ca1\u6709\u627e\u5230\u8fd9\u4e2a\u77ed\u7801\u5bf9\u5e94\u7684\u8d44\u6e90\uff0c\u8bf7\u786e\u8ba4\u540e\u518d\u8bd5\u3002")
        return

    if not await is_channel_member(bot, message.from_user.id):
        await session.commit()
        await send_subscribe_prompt(message, short_code)
        return

    if await is_rate_limited(session, message.from_user.id):
        await session.commit()
        await message.answer("\u8bbf\u95ee\u592a\u9891\u7e41\u4e86\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002")
        return

    try:
        await send_resource(bot, message.chat.id, resource)
    except Exception:
        logger.exception("Failed to send resource %s to user %s", resource.id, user.user_id)
        await session.rollback()
        await message.answer("\u8d44\u6e90\u53d1\u9001\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u6216\u8054\u7cfb\u7ba1\u7406\u5458\u3002")
        return

    await log_download(session, user=user, resource=resource)
    await session.commit()


def extract_media_payload(message: Message) -> dict[str, str] | None:
    caption = message.caption or ""
    if message.video:
        title = caption.splitlines()[0] if caption else (message.video.file_name or "")
        return {
            "file_id": message.video.file_id,
            "file_type": "video",
            "caption": caption,
            "title": title,
        }
    if message.photo:
        photo = message.photo[-1]
        title = caption.splitlines()[0] if caption else ""
        return {
            "file_id": photo.file_id,
            "file_type": "photo",
            "caption": caption,
            "title": title,
        }
    if message.document:
        title = caption.splitlines()[0] if caption else (message.document.file_name or "")
        return {
            "file_id": message.document.file_id,
            "file_type": "document",
            "caption": caption,
            "title": title,
        }
    return None
