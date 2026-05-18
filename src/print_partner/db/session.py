"""Database session and helpers."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session, sessionmaker

from print_partner.config import settings
from print_partner.core.merge import MergePart, MergeResult
from print_partner.db.models import (
    AppSetting,
    Base,
    BuildProfile,
    Part,
    PrintProgress,
    ProfileLayer,
    Project,
)


def get_engine():
    settings.ensure_dirs()
    return create_engine(f"sqlite:///{settings.db_path}", echo=False)


SessionLocal = sessionmaker(autocommit=False, autoflush=False)


def _migrate_projects_source_type(engine) -> None:
    insp = inspect(engine)
    if "projects" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("projects")}
    if "source_type" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE projects ADD COLUMN source_type TEXT DEFAULT 'git'"))


def _migrate_parts_filament_color(engine) -> None:
    insp = inspect(engine)
    if "parts" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("parts")}
    if "filament_color_id" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE parts ADD COLUMN filament_color_id TEXT"))


def _migrate_build_profiles_order_number(engine) -> None:
    insp = inspect(engine)
    if "build_profiles" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("build_profiles")}
    if "order_number" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE build_profiles ADD COLUMN order_number TEXT"))


def init_db() -> None:
    engine = get_engine()
    Base.metadata.create_all(engine)
    _migrate_projects_source_type(engine)
    _migrate_parts_filament_color(engine)
    _migrate_build_profiles_order_number(engine)


def get_setting(session: Session, key: str, default: str | None = None) -> str | None:
    row = session.get(AppSetting, key)
    if row is None or row.value == "":
        return default
    return row.value


def set_setting(session: Session, key: str, value: str) -> None:
    row = session.get(AppSetting, key)
    if row is None:
        session.add(AppSetting(key=key, value=value))
    else:
        row.value = value


def get_setting_value(key: str, default: str | None = None) -> str | None:
    with db_session() as session:
        return get_setting(session, key, default)


def set_setting_value(key: str, value: str) -> None:
    with db_session() as session:
        set_setting(session, key, value)


@contextmanager
def db_session() -> Generator[Session, None, None]:
    engine = get_engine()
    session = SessionLocal(bind=engine)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def merge_part_to_row(profile_id: int, mp: MergePart) -> Part:
    return Part(
        profile_id=profile_id,
        match_key=mp.match_key,
        relative_path=mp.relative_path,
        filename=mp.filename,
        source_layer=mp.source_layer,
        status=mp.status,
        role=mp.role,
        quantity_auto=mp.quantity_auto,
        quantity_override=mp.quantity_override,
        quantity_effective=mp.quantity_effective,
        included=mp.included,
        notes=mp.notes,
        geometry_same=mp.geometry_same,
    )


def row_to_merge_part(row: Part) -> MergePart:
    return MergePart(
        match_key=row.match_key,
        relative_path=row.relative_path,
        filename=row.filename,
        source_layer=row.source_layer,
        status=row.status,
        role=row.role,
        quantity_auto=row.quantity_auto,
        quantity_override=row.quantity_override,
        part_slug=row.filename,
        included=row.included,
        notes=row.notes or "",
        geometry_same=row.geometry_same,
    )


def save_merge_result(session: Session, profile_id: int, result: MergeResult) -> None:
    from sqlalchemy import delete

    from print_partner.core.print_progress import ensure_profile_progress

    existing_rows = list(session.scalars(select(Part).where(Part.profile_id == profile_id)).all())
    existing = {p.match_key: row_to_merge_part(p) for p in existing_rows}
    filament_by_key = {p.match_key: p.filament_color_id for p in existing_rows}
    session.execute(delete(Part).where(Part.profile_id == profile_id))
    for mp in result.parts:
        prior = existing.get(mp.match_key)
        if prior:
            if prior.quantity_override is not None:
                mp.quantity_override = prior.quantity_override
            mp.notes = prior.notes or mp.notes
            mp.included = prior.included
        row = merge_part_to_row(profile_id, mp)
        row.filament_color_id = filament_by_key.get(mp.match_key)
        session.add(row)
    session.flush()
    ensure_profile_progress(session, profile_id)


def list_projects(session: Session) -> list[Project]:
    return list(session.scalars(select(Project).order_by(Project.name)).all())


def list_profiles(session: Session) -> list[BuildProfile]:
    return list(session.scalars(select(BuildProfile).order_by(BuildProfile.name)).all())


def get_profile_layers(session: Session, profile_id: int) -> list[ProfileLayer]:
    return list(
        session.scalars(
            select(ProfileLayer)
            .where(ProfileLayer.profile_id == profile_id)
            .order_by(ProfileLayer.layer_order)
        ).all()
    )


def get_profile_parts(session: Session, profile_id: int) -> list[Part]:
    return list(
        session.scalars(select(Part).where(Part.profile_id == profile_id).order_by(Part.filename)).all()
    )


def part_to_display_dict(part: Part, session: Session | None = None) -> dict:
    """Snapshot Part fields while session is open (avoids DetachedInstanceError in UI)."""
    from print_partner.core.ambrosia_catalog import get_color_by_id
    from print_partner.core.print_progress import get_print_units

    filament_id = part.filament_color_id
    color = get_color_by_id(filament_id)
    qty = max(1, part.quantity_effective)
    print_units: list[bool] = []
    printed_count = 0
    if session is not None:
        print_units = get_print_units(session, part.id, qty)
        printed_count = sum(print_units)
    return {
        "id": part.id,
        "match_key": part.match_key,
        "part_slug": part.filename,
        "filename": part.filename,
        "status": part.status,
        "role": part.role,
        "quantity_effective": part.quantity_effective,
        "source_layer": part.source_layer,
        "included": part.included,
        "relative_path": part.relative_path,
        "notes": part.notes or "",
        "filament_color_id": filament_id,
        "filament_display": color.combo_label if color else "",
        "filament_hex": color.hex if color else None,
        "printed_count": printed_count,
        "print_units": print_units,
    }


def bulk_set_filament_color(
    session: Session,
    profile_id: int,
    role: str,
    color_id: str | None,
    *,
    included_only: bool = True,
) -> int:
    """Assign filament color to all parts with the given role. Returns rows updated."""
    parts = session.scalars(select(Part).where(Part.profile_id == profile_id)).all()
    count = 0
    for part in parts:
        if part.role != role:
            continue
        if included_only and not part.included:
            continue
        part.filament_color_id = color_id
        count += 1
    return count
