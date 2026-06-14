from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
import secrets

from fastapi import Depends, FastAPI, Form, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.templating import Jinja2Templates
from sqlalchemy.exc import IntegrityError

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from app.config import get_settings
from app.database import async_session, init_db
from app.repositories import (
    create_resource,
    delete_resource,
    get_resource,
    get_resource_by_code,
    list_resources,
    list_users,
    update_resource,
    get_total_users,
    get_daily_user_registrations,
    get_daily_downloads,
    get_daily_active_users,
)


templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
security = HTTPBasic()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="ResourcesGetBot Admin", lifespan=lifespan)


def require_admin(credentials: HTTPBasicCredentials = Depends(security)) -> str:
    settings = get_settings()
    username_ok = secrets.compare_digest(
        credentials.username,
        settings.web_admin_username,
    )
    password_ok = secrets.compare_digest(
        credentials.password,
        settings.web_admin_password,
    )
    if not (username_ok and password_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


@app.get("/")
async def index(_: str = Depends(require_admin)) -> RedirectResponse:
    return RedirectResponse(url="/admin", status_code=status.HTTP_303_SEE_OTHER)


@app.get("/admin")
async def admin_resources(request: Request, _: str = Depends(require_admin)):
    async with async_session() as session:
        resources = await list_resources(session)
    return templates.TemplateResponse(
        request,
        "resources.html",
        {"request": request, "resources": resources},
    )


@app.get("/admin/resources/new")
async def new_resource_form(request: Request, _: str = Depends(require_admin)):
    return templates.TemplateResponse(
        request,
        "resource_form.html",
        {
            "request": request,
            "resource": None,
            "action": "/admin/resources",
            "error": "",
        },
    )


@app.post("/admin/resources")
async def create_resource_action(
    request: Request,
    short_code: str = Form(...),
    title: str = Form(""),
    tags: str = Form(""),
    author: str = Form(""),
    quality: str = Form(""),
    mosaic_status: str = Form(""),
    video_direction: str = Form(""),
    file_id: str = Form(...),
    file_type: str = Form(...),
    caption: str = Form(""),
    _: str = Depends(require_admin),
):
    async with async_session() as session:
        if await get_resource_by_code(session, short_code):
            return templates.TemplateResponse(
                request,
                "resource_form.html",
                {
                    "request": request,
                    "resource": None,
                    "action": "/admin/resources",
                    "error": "短码已存在，请换一个。",
                },
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        try:
            await create_resource(
                session,
                short_code=short_code,
                title=title or short_code,
                tags=tags,
                author=author or None,
                quality=quality or None,
                mosaic_status=mosaic_status or None,
                video_direction=video_direction or None,
                file_id=file_id,
                file_type=file_type,
                caption=caption,
                created_by=0,
            )
            await session.commit()
        except IntegrityError:
            await session.rollback()
            return templates.TemplateResponse(
                request,
                "resource_form.html",
                {
                    "request": request,
                    "resource": None,
                    "action": "/admin/resources",
                    "error": "保存失败：短码可能已存在。",
                },
                status_code=status.HTTP_400_BAD_REQUEST,
            )
    return RedirectResponse(url="/admin", status_code=status.HTTP_303_SEE_OTHER)


@app.get("/admin/resources/{resource_id}/edit")
async def edit_resource_form(
    resource_id: int,
    request: Request,
    _: str = Depends(require_admin),
):
    async with async_session() as session:
        resource = await get_resource(session, resource_id)
        if resource is None:
            raise HTTPException(status_code=404, detail="Resource not found")
    return templates.TemplateResponse(
        request,
        "resource_form.html",
        {
            "request": request,
            "resource": resource,
            "action": f"/admin/resources/{resource_id}/edit",
            "error": "",
        },
    )


@app.post("/admin/resources/{resource_id}/edit")
async def edit_resource_action(
    resource_id: int,
    request: Request,
    short_code: str = Form(...),
    title: str = Form(""),
    tags: str = Form(""),
    author: str = Form(""),
    quality: str = Form(""),
    mosaic_status: str = Form(""),
    video_direction: str = Form(""),
    file_id: str = Form(...),
    file_type: str = Form(...),
    caption: str = Form(""),
    _: str = Depends(require_admin),
):
    async with async_session() as session:
        resource = await get_resource(session, resource_id)
        if resource is None:
            raise HTTPException(status_code=404, detail="Resource not found")

        existing = await get_resource_by_code(session, short_code)
        if existing is not None and existing.id != resource_id:
            return templates.TemplateResponse(
                request,
                "resource_form.html",
                {
                    "request": request,
                    "resource": resource,
                    "action": f"/admin/resources/{resource_id}/edit",
                    "error": "短码已被其他资源使用。",
                },
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        await update_resource(
            session,
            resource,
            short_code=short_code,
            title=title or short_code,
            tags=tags,
            author=author or None,
            quality=quality or None,
            mosaic_status=mosaic_status or None,
            video_direction=video_direction or None,
            file_id=file_id,
            file_type=file_type,
            caption=caption,
        )
        await session.commit()
    return RedirectResponse(url="/admin", status_code=status.HTTP_303_SEE_OTHER)


@app.post("/admin/resources/{resource_id}/delete")
async def delete_resource_action(
    resource_id: int,
    _: str = Depends(require_admin),
) -> RedirectResponse:
    async with async_session() as session:
        await delete_resource(session, resource_id)
        await session.commit()
    return RedirectResponse(url="/admin", status_code=status.HTTP_303_SEE_OTHER)



@app.get("/admin/stats")
async def admin_stats(request: Request, _: str = Depends(require_admin)):
    return templates.TemplateResponse(
        request, "stats.html",
        {"request": request},
    )


@app.get("/admin/stats/data")
async def admin_stats_data(_: str = Depends(require_admin)):
    async with async_session() as session:
        total_users = await get_total_users(session)
        daily_registrations = await get_daily_user_registrations(session)
        daily_downloads = await get_daily_downloads(session)
        daily_active_users = await get_daily_active_users(session)
    return {
        "total_users": total_users,
        "daily_registrations": daily_registrations,
        "daily_downloads": daily_downloads,
        "daily_active_users": daily_active_users,
    }


@app.get("/admin/broadcast")
async def broadcast_form(request: Request, _: str = Depends(require_admin)):
    return templates.TemplateResponse(
        request, "broadcast.html",
        {"request": request, "result": None},
    )


@app.post("/admin/broadcast")
async def broadcast_send(
    request: Request,
    message_text: str = Form(""),
    file_id: str = Form(""),
    file_type: str = Form(""),
    _: str = Depends(require_admin),
):
    if not message_text.strip() and not file_id.strip():
        return templates.TemplateResponse(
            request, "broadcast.html",
            {"request": request, "result": {"error": "\u8bf7\u8f93\u5165\u6d88\u606f\u5185\u5bb9\u6216\u8005\u4e0a\u4f20\u5a92\u4f53"}},
        )

    settings = get_settings()
    bot = Bot(
        token=settings.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    try:
        async with async_session() as session:
            user_ids = await get_all_user_ids(session)

        success = 0
        failed = 0
        for uid in user_ids:
            try:
                if file_id.strip() and file_type.strip():
                    if file_type == "photo":
                        await bot.send_photo(chat_id=uid, photo=file_id.strip(), caption=message_text or None)
                    elif file_type == "video":
                        await bot.send_video(chat_id=uid, video=file_id.strip(), caption=message_text or None)
                    elif file_type == "document":
                        await bot.send_document(chat_id=uid, document=file_id.strip(), caption=message_text or None)
                else:
                    await bot.send_message(chat_id=uid, text=message_text)
                success += 1
            except Exception:
                failed += 1
    finally:
        await bot.session.close()

    return templates.TemplateResponse(
        request, "broadcast.html",
        {"request": request, "result": {"success": success, "failed": failed}},
    )


# Add ban/unban routes
@app.post("/admin/users/{user_id}/ban")
async def ban_user_action(user_id: int, _: str = Depends(require_admin)):
    async with async_session() as session:
        user = await ban_user(session, user_id)
        if user:
            await session.commit()
    return RedirectResponse(url="/admin/users", status_code=status.HTTP_303_SEE_OTHER)


@app.post("/admin/users/{user_id}/unban")
async def unban_user_action(user_id: int, _: str = Depends(require_admin)):
    async with async_session() as session:
        user = await unban_user(session, user_id)
        if user:
            await session.commit()
    return RedirectResponse(url="/admin/users", status_code=status.HTTP_303_SEE_OTHER)


@app.get("/admin/users")
async def admin_users(request: Request, _: str = Depends(require_admin)):
    async with async_session() as session:
        users = await list_users(session)
    return templates.TemplateResponse(
        request,
        "users.html",
        {"request": request, "users": users},
    )

