from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from app.config import get_settings


def subscribe_keyboard(short_code: str) -> InlineKeyboardMarkup:
    settings = get_settings()
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="\U0001f525\u9e21\u6536\u85cf\u5939|\u6e05\u6f88\u5206\u7c7b", url=settings.channel_url)],
            [InlineKeyboardButton(text="\u2705\u6211\u5df2\u5173\u6ce8", callback_data=f"sub_check:{short_code}")],
        ]
    )


def quality_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="4K", callback_data="quality:4K"),
                InlineKeyboardButton(text="1080+", callback_data="quality:1080+"),
                InlineKeyboardButton(text="1080P", callback_data="quality:1080P"),
            ],
            [
                InlineKeyboardButton(text="720P", callback_data="quality:720P"),
                InlineKeyboardButton(text="480P", callback_data="quality:480P"),
            ],
        ]
    )


def mosaic_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="#\u6709\u7801", callback_data="mosaic:\u6709\u7801"),
                InlineKeyboardButton(text="#\u65e0\u7801", callback_data="mosaic:\u65e0\u7801"),
                InlineKeyboardButton(text="#\u65e0\u7801\u4fee\u590d", callback_data="mosaic:\u65e0\u7801\u4fee\u590d"),
            ],
        ]
    )


def direction_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="#\u7ad6\u5c4f", callback_data="direction:\u7ad6\u5c4f"),
                InlineKeyboardButton(text="#\u6a2a\u5c4f", callback_data="direction:\u6a2a\u5c4f"),
            ],
        ]
    )
