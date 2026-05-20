"""SQLAlchemy ORM models."""

from __future__ import annotations  # required for Mapped[X | Y] on Python 3.9

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False, unique=True)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    source_type: Mapped[str] = mapped_column(String(16), default="git")  # git | local
    branch: Mapped[str] = mapped_column(String(128), default="main")
    local_path: Mapped[Optional[str]] = mapped_column(String(2048))
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    last_commit_sha: Mapped[Optional[str]] = mapped_column(String(64))
    docs_url: Mapped[Optional[str]] = mapped_column(String(1024))
    # JSON list of import rules; NULL = legacy import all STLs
    imported_paths: Mapped[Optional[str]] = mapped_column(Text)

    layers: Mapped[list["ProfileLayer"]] = relationship(back_populates="project")


class BuildProfile(Base):
    __tablename__ = "build_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False, unique=True)
    order_number: Mapped[Optional[str]] = mapped_column(String(128))

    layers: Mapped[list["ProfileLayer"]] = relationship(
        back_populates="profile", cascade="all, delete-orphan", order_by="ProfileLayer.layer_order"
    )
    parts: Mapped[list["Part"]] = relationship(
        back_populates="profile", cascade="all, delete-orphan"
    )


class ProfileLayer(Base):
    __tablename__ = "profile_layers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("build_profiles.id", ondelete="CASCADE"))
    layer_order: Mapped[int] = mapped_column(Integer, default=0)
    layer_type: Mapped[str] = mapped_column(String(16))  # base|addon|manual
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"))

    profile: Mapped["BuildProfile"] = relationship(back_populates="layers")
    project: Mapped[Optional["Project"]] = relationship(back_populates="layers")


class Part(Base):
    __tablename__ = "parts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("build_profiles.id", ondelete="CASCADE"))
    match_key: Mapped[str] = mapped_column(String(2048), nullable=False)
    relative_path: Mapped[str] = mapped_column(String(2048))
    filename: Mapped[str] = mapped_column(String(512))
    source_layer: Mapped[str] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(32), default="base")
    role: Mapped[str] = mapped_column(String(32), default="primary")
    filament_color_id: Mapped[Optional[str]] = mapped_column(String(256))
    filament_custom_hex: Mapped[Optional[str]] = mapped_column(Text)
    quantity_auto: Mapped[int] = mapped_column(Integer, default=1)
    quantity_override: Mapped[Optional[int]] = mapped_column(Integer)
    quantity_effective: Mapped[int] = mapped_column(Integer, default=1)
    included: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    github_blob_url: Mapped[Optional[str]] = mapped_column(String(2048))
    geometry_same: Mapped[Optional[bool]] = mapped_column(Boolean)

    profile: Mapped["BuildProfile"] = relationship(back_populates="parts")
    progress: Mapped[list["PrintProgress"]] = relationship(
        back_populates="part", cascade="all, delete-orphan"
    )


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


class PrintProgress(Base):
    __tablename__ = "print_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id", ondelete="CASCADE"))
    unit_index: Mapped[int] = mapped_column(Integer, default=0)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)

    part: Mapped["Part"] = relationship(back_populates="progress")
