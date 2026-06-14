from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Resource(Base):
    __tablename__ = "resources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    short_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    tags: Mapped[str] = mapped_column(Text, default="")
    file_id: Mapped[str] = mapped_column(Text)
    file_type: Mapped[str] = mapped_column(String(32), index=True)
    caption: Mapped[str] = mapped_column(Text, default="")
    author: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    quality: Mapped[str | None] = mapped_column(String(32), nullable=True, default=None)
    mosaic_status: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    video_direction: Mapped[str | None] = mapped_column(String(32), nullable=True, default=None)
    created_by: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )

    downloads: Mapped[list["DownloadLog"]] = relationship(
        back_populates="resource",
        cascade="all, delete-orphan",
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    username: Mapped[str] = mapped_column(String(255), default="")
    first_name: Mapped[str] = mapped_column(String(255), default="")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    download_count: Mapped[int] = mapped_column(Integer, default=0)

    downloads: Mapped[list["DownloadLog"]] = relationship(back_populates="user")


class DownloadLog(Base):
    __tablename__ = "download_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.user_id"), index=True)
    resource_id: Mapped[int] = mapped_column(ForeignKey("resources.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    user: Mapped[User] = relationship(back_populates="downloads")
    resource: Mapped[Resource] = relationship(back_populates="downloads")

