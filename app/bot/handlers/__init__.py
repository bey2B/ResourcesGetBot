from aiogram import Router

from app.bot.handlers import admin, errors, user


def setup_routers() -> Router:
    router = Router()
    router.include_router(admin.router)
    router.include_router(user.router)
    router.include_router(errors.router)
    return router

