from __future__ import annotations

from aiogram import Bot, F, Router
from aiogram.filters import CommandObject, CommandStart
from aiogram.types import CallbackQuery, Message

from app.bot.services import SHORT_CODE_RE, handle_resource_request, is_channel_member, send_resource
from app.database import async_session
from app.repositories import get_resource_by_code, upsert_user
from app.bot.keyboards import subscribe_keyboard


router = Router(name="user")


@router.message(CommandStart())
async def start(message: Message, command: CommandObject, bot: Bot) -> None:
    if message.from_user is None:
        return

    args = (command.args or "").strip()
    if args:
        async with async_session() as session:
            await handle_resource_request(
                message=message,
                bot=bot,
                session=session,
                short_code=args,
            )
        return

    async with async_session() as session:
        await upsert_user(session, message.from_user)
        await session.commit()

    await message.answer(
        "\u6b22\u8fce\u4f7f\u7528\u8d44\u6e90 Bot\u3002\n"
        "\u8bf7\u53d1\u9001\u8d44\u6e90\u77ed\u7801\uff0c\u6216\u901a\u8fc7\u4e13\u5c5e\u94fe\u63a5\u76f4\u63a5\u83b7\u53d6\u8d44\u6e90\u3002"
    )


@router.message(F.chat.type == "private", F.text.regexp(SHORT_CODE_RE.pattern))
async def get_by_short_code(message: Message, bot: Bot) -> None:
    async with async_session() as session:
        await handle_resource_request(
            message=message,
            bot=bot,
            session=session,
            short_code=message.text or "",
        )


@router.message(F.chat.type == "private", F.text)
async def unknown_text(message: Message) -> None:
    await message.answer("本机器人非双向机器人,双向请用 @LingFaBot")


# -------- Callback: user clicked "\u2705\u6211\u5df2\u5173\u6ce8" --------
@router.callback_query(F.data.startswith("sub_check:"))
async def check_subscription(callback: CallbackQuery, bot: Bot) -> None:
    if callback.from_user is None:
        return

    short_code = callback.data.split(":", 1)[1]
    user_id = callback.from_user.id

    if not await is_channel_member(bot, user_id):
        await callback.answer("\u4ecd\u672a\u68c0\u6d4b\u5230\u5173\u6ce8\uff0c\u8bf7\u5148\u52a0\u5165\u9891\u9053\u540e\u518d\u70b9\u51fb", show_alert=True)
        return

    async with async_session() as session:
        resource = await get_resource_by_code(session, short_code)
        if resource is None:
            await callback.answer("\u8be5\u8d44\u6e90\u5df2\u4e0d\u5b58\u5728", show_alert=True)
            await callback.message.delete()
            return

        await callback.message.delete()

        # Check rate limit
        from app.bot.services import is_rate_limited
        if await is_rate_limited(session, user_id):
            await callback.message.answer("\u8bbf\u95ee\u592a\u8fc7\u7e41\u5fd9\u4e86\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002")
            return

        # Log the download
        user = await upsert_user(session, callback.from_user)
        from app.repositories import log_download
        await log_download(session, user=user, resource=resource)
        await session.commit()

    try:
        await send_resource(bot, callback.from_user.id, resource)
    except Exception:
        await callback.message.answer("\u8d44\u6e90\u53d1\u9001\u5931\u8d25\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u3002")
        return

    await callback.answer("\u5df2\u9a8c\u8bc1\uff0c\u6b63\u5728\u53d1\u9001\u8d44\u6e90...")
