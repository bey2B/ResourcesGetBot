from __future__ import annotations

import logging
import re
import secrets

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from app.bot.services import SHORT_CODE_RE, extract_media_payload
from app.bot.states import AddResourceState
from app.bot.keyboards import quality_keyboard, mosaic_keyboard, direction_keyboard
from app.config import get_settings
from app.database import async_session
from app.repositories import create_resource, get_resource_by_code


logger = logging.getLogger(__name__)
router = Router(name="admin")


def _is_admin(message: Message) -> bool:
    return bool(message.from_user and message.from_user.id in get_settings().admin_user_ids)


def _is_admin_cb(callback: CallbackQuery) -> bool:
    return bool(callback.from_user and callback.from_user.id in get_settings().admin_user_ids)


def _parse_attributes(text: str) -> dict:
    title = None
    author = None
    tags = []
    current_flag = None
    for part in text.strip().split():
        if part == "-t":
            current_flag = "title" if title is None else "tag"
        elif part == "-a":
            current_flag = "author"
        elif current_flag == "title":
            title = part
            current_flag = None
        elif current_flag == "author":
            author = part
            current_flag = None
        elif current_flag == "tag":
            tags.append(part)
            current_flag = None
    return {
        "title": title or None,
        "author": author or None,
        "tags": " ".join(tags) if tags else None,
    }


def _generate_short_code() -> str:
    return secrets.token_hex(4)  # 8-character hex code


@router.message(Command("cancel"))
async def cancel(message: Message, state: FSMContext) -> None:
    if not _is_admin(message):
        return
    await state.clear()
    await message.answer("\u5df2\u53d6\u6d88\u5f53\u524d\u64cd\u4f5c\u3002")


@router.message(F.chat.type == "private", F.content_type.in_({"video", "photo", "document"}))
async def receive_resource_media(message: Message, state: FSMContext) -> None:
    if not _is_admin(message):
        return

    payload = extract_media_payload(message)
    if payload is None:
        await message.answer("\u6682\u4e0d\u652f\u6301\u8fd9\u79cd\u6587\u4ef6\u7c7b\u578b\uff0c\u8bf7\u53d1\u9001\u89c6\u9891\u3001\u56fe\u7247\u6216\u6587\u6863\u3002")
        return

    await state.set_state(AddResourceState.waiting_attributes)
    await state.update_data(**payload)
    await message.answer(
        "\u5df2\u8bfb\u53d6\u5a92\u4f53\u4fe1\u606f\u3002\n"
        "\u8bf7\u53d1\u9001\u5c5e\u6027\uff0c\u683c\u5f0f\uff1a-t \u6807\u9898 -a \u4f5c\u8005 -t TAG1 -t TAG2\n"
        "\u793a\u4f8b\uff1a-t MyVideo -a JohnDoe -t \u6e05\u7eaf -t \u65e5\u672c\n"
        "\u8fd9\u4e09\u4e2a\u53ef\u4ee5\u4e0d\u8f93\u5165\uff0c\u4e0d\u8f93\u5165\u5219\u4e3a\u7a7a\u3002\n"
        "\u53d1\u9001 /cancel \u53ef\u53d6\u6d88\u3002"
    )


@router.message(AddResourceState.waiting_attributes, F.text)
async def process_attributes(message: Message, state: FSMContext) -> None:
    if not _is_admin(message) or message.from_user is None:
        return

    text = (message.text or "").strip()
    attrs = _parse_attributes(text)

    await state.update_data(**attrs)

    await state.set_state(AddResourceState.waiting_quality)
    await message.answer(
        "\u8bf7\u9009\u62e9\u6e05\u6670\u5ea6/\u8d28\u91cf\uff1a",
        reply_markup=quality_keyboard(),
    )


@router.message(AddResourceState.waiting_attributes)
async def unsupported_attributes_message(message: Message) -> None:
    if _is_admin(message):
        await message.answer("\u8bf7\u7528\u6587\u672c\u53d1\u9001\u5c5e\u6027\uff0c\u683c\u5f0f\uff1a-t \u6807\u9898 -a \u4f5c\u8005 -t TAG\uff0c\u6216\u53d1\u9001 /cancel \u53d6\u6d88\u3002")


@router.callback_query(F.data.startswith("quality:"))
async def process_quality(callback: CallbackQuery, state: FSMContext) -> None:
    if not _is_admin_cb(callback):
        await callback.answer("\u6ca1\u6709\u6743\u9650", show_alert=True)
        return

    quality = callback.data.split(":", 1)[1]
    await state.update_data(quality=quality)
    await callback.answer()
    await callback.message.delete()

    await state.set_state(AddResourceState.waiting_mosaic)
    await callback.message.answer(
        "\u8bf7\u9009\u62e9\u9a6c\u8d5b\u514b\u72b6\u6001\uff1a",
        reply_markup=mosaic_keyboard(),
    )


@router.callback_query(F.data.startswith("mosaic:"))
async def process_mosaic(callback: CallbackQuery, state: FSMContext) -> None:
    if not _is_admin_cb(callback):
        await callback.answer("\u6ca1\u6709\u6743\u9650", show_alert=True)
        return

    mosaic = callback.data.split(":", 1)[1]
    await state.update_data(mosaic_status=mosaic)
    await callback.answer()
    await callback.message.delete()

    await state.set_state(AddResourceState.waiting_direction)
    await callback.message.answer(
        "\u8bf7\u9009\u62e9\u89c6\u9891\u65b9\u5411\uff1a",
        reply_markup=direction_keyboard(),
    )


@router.callback_query(F.data.startswith("direction:"))
async def process_direction(callback: CallbackQuery, state: FSMContext) -> None:
    if not _is_admin_cb(callback) or callback.from_user is None:
        await callback.answer("\u6ca1\u6709\u6743\u9650", show_alert=True)
        return

    direction = callback.data.split(":", 1)[1]
    data = await state.update_data(video_direction=direction)
    await callback.answer()
    await callback.message.delete()

    # Auto-generate short code
    short_code = _generate_short_code()

    async with async_session() as session:
        exists = await get_resource_by_code(session, short_code)
        while exists is not None:
            short_code = _generate_short_code()
            exists = await get_resource_by_code(session, short_code)

        title = data.get("title") or short_code
        await create_resource(
            session,
            short_code=short_code,
            title=title,
            author=data.get("author"),
            tags=data.get("tags") or "",
            quality=data.get("quality"),
            mosaic_status=data.get("mosaic_status"),
            video_direction=data.get("video_direction"),
            file_id=data["file_id"],
            file_type=data["file_type"],
            caption=data.get("caption", ""),
            created_by=callback.from_user.id,
        )
        await session.commit()

    await state.clear()
    logger.info("Admin %s created resource %s", callback.from_user.id, short_code)
    title_text = data.get('title') or "\u65e0"
    author_text = data.get('author') or "\u65e0"
    tags_text = data.get('tags') or "\u65e0"
    quality_text = data.get('quality') or "\u672a\u8bbe\u7f6e"
    mosaic_text = data.get('mosaic_status') or "\u672a\u8bbe\u7f6e"
    direction_text = data.get('video_direction') or "\u672a\u8bbe\u7f6e"
    await callback.message.answer(
        f"\u8d44\u6e90\u5df2\u4fdd\u5b58\u3002\n"
        f"\u77ed\u7801\uff1a{short_code}\n"
        f"\u6807\u9898\uff1a{title_text}\n"
        f"\u4f5c\u8005\uff1a{author_text}\n"
        f"TAG\uff1a{tags_text}\n"
        f"\u6e05\u6670\u5ea6\uff1a{quality_text}\n"
        f"\u9a6c\u8d5b\u514b\uff1a{mosaic_text}\n"
        f"\u89c6\u9891\u65b9\u5411\uff1a{direction_text}"
    )


@router.message(AddResourceState.waiting_quality)
async def unsupported_quality_message(message: Message) -> None:
    if _is_admin(message):
        await message.answer("\u8bf7\u70b9\u51fb\u4e0b\u65b9\u6309\u94ae\u9009\u62e9\u6e05\u6670\u5ea6\uff0c\u6216\u53d1\u9001 /cancel \u53d6\u6d88\u3002")


@router.message(AddResourceState.waiting_mosaic)
async def unsupported_mosaic_message(message: Message) -> None:
    if _is_admin(message):
        await message.answer("\u8bf7\u70b9\u51fb\u4e0b\u65b9\u6309\u94ae\u9009\u62e9\u9a6c\u8d5b\u514b\u72b6\u6001\uff0c\u6216\u53d1\u9001 /cancel \u53d6\u6d88\u3002")


@router.message(AddResourceState.waiting_direction)
async def unsupported_direction_message(message: Message) -> None:
    if _is_admin(message):
        await message.answer("\u8bf7\u70b9\u51fb\u4e0b\u65b9\u6309\u94ae\u9009\u62e9\u89c6\u9891\u65b9\u5411\uff0c\u6216\u53d1\u9001 /cancel \u53d6\u6d88\u3002")
