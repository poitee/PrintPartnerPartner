"""Database session and helpers."""

from __future__ import annotations

from collections.abc import Callable, Generator
from contextlib import contextmanager

from sqlalchemy import Engine, case, create_engine, func, inspect, select, text
from sqlalchemy.orm import Session, sessionmaker

from print_partner.config import settings
from print_partner.core.merge import MergePart, MergeResult
from print_partner.db.models import (
    AppSetting,
    Base,
    BuildProfile,
    Part,
    ProfileLayer,
    Project,
)


def get_engine():
    settings.ensure_dirs()
    return create_engine(f"sqlite:///{settings.db_path}", echo=False)


SessionLocal = sessionmaker(autocommit=False, autoflush=False)

SCHEMA_VERSION_KEY = "schema_version"
CURRENT_SCHEMA_VERSION = 6

SCHEMA_MIGRATIONS: list[tuple[int, Callable[[Engine], None]]] = []


def _migrate_projects_source_type(engine: Engine) -> None:
    insp = inspect(engine)
    if "projects" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("projects")}
    if "source_type" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE projects ADD COLUMN source_type TEXT DEFAULT 'git'"))


def _migrate_parts_filament_color(engine: Engine) -> None:
    insp = inspect(engine)
    if "parts" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("parts")}
    if "filament_color_id" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE parts ADD COLUMN filament_color_id TEXT"))


def _migrate_parts_filament_custom_hex(engine: Engine) -> None:
    insp = inspect(engine)
    if "parts" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("parts")}
    if "filament_custom_hex" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE parts ADD COLUMN filament_custom_hex TEXT"))


def _migrate_projects_imported_paths(engine: Engine) -> None:
    insp = inspect(engine)
    if "projects" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("projects")}
    if "imported_paths" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE projects ADD COLUMN imported_paths TEXT"))


def _migrate_build_profiles_order_number(engine: Engine) -> None:
    insp = inspect(engine)
    if "build_profiles" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("build_profiles")}
    if "order_number" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE build_profiles ADD COLUMN order_number TEXT"))


def _migrate_fix_empty_import_rules(engine: Engine) -> None:
    """Treat legacy [] as import-all — empty rules were wiping profiles on Recompute."""
    insp = inspect(engine)
    if "projects" not in insp.get_table_names():
        return
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE projects SET imported_paths = NULL WHERE imported_paths = '[]'")
        )


SCHEMA_MIGRATIONS.extend(
    [
        (1, _migrate_projects_source_type),
        (2, _migrate_parts_filament_color),
        (3, _migrate_parts_filament_custom_hex),
        (4, _migrate_build_profiles_order_number),
        (5, _migrate_projects_imported_paths),
        (6, _migrate_fix_empty_import_rules),
    ]
)


def _read_schema_version(engine: Engine) -> int:
    insp = inspect(engine)
    if "app_settings" not in insp.get_table_names():
        return 0
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT value FROM app_settings WHERE key = :key"),
            {"key": SCHEMA_VERSION_KEY},
        ).fetchone()
    if not row or not row[0]:
        return 0
    try:
        return int(row[0])
    except ValueError:
        return 0


def _write_schema_version(engine: Engine, version: int) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO app_settings (key, value) VALUES (:key, :val) "
                "ON CONFLICT(key) DO UPDATE SET value = :val"
            ),
            {"key": SCHEMA_VERSION_KEY, "val": str(version)},
        )


def _apply_migrations(engine: Engine) -> None:
    current = _read_schema_version(engine)
    for version, migrate in sorted(SCHEMA_MIGRATIONS, key=lambda t: t[0]):
        if version <= current:
            continue
        migrate(engine)
        _write_schema_version(engine, version)


def get_schema_version(engine: Engine | None = None) -> int:
    eng = engine or get_engine()
    return _read_schema_version(eng)


def init_db() -> None:
    engine = get_engine()
    Base.metadata.create_all(engine)
    _apply_migrations(engine)


class MergeWouldWipeProfileError(ValueError):
    """Raised when a merge would delete all parts (e.g. import rules block every STL)."""


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


def _apply_merge_to_existing_part(row: Part, mp: MergePart) -> None:
    """Update an existing part row in place so print_progress rows keep the same part_id."""
    row.relative_path = mp.relative_path
    row.filename = mp.filename
    row.source_layer = mp.source_layer
    row.status = mp.status
    row.quantity_auto = mp.quantity_auto
    row.geometry_same = mp.geometry_same
    row.notes = mp.notes
    row.included = mp.included
    # Keep role / filament from the row unless merge explicitly carried overrides.
    if mp.quantity_override is not None:
        row.quantity_override = mp.quantity_override
    row.quantity_effective = (
        row.quantity_override if row.quantity_override is not None else row.quantity_auto
    )


def save_merge_result(session: Session, profile_id: int, result: MergeResult) -> None:
    from print_partner.core.print_progress import ensure_profile_progress

    existing_rows = list(session.scalars(select(Part).where(Part.profile_id == profile_id)).all())
    if not result.parts and existing_rows:
        raise MergeWouldWipeProfileError(
            "Scan found no STL files (check Projects → Import files… for each repo). "
            "Existing parts were not removed."
        )
    existing_by_key = {p.match_key: p for p in existing_rows}
    existing_merge = {p.match_key: row_to_merge_part(p) for p in existing_rows}
    filament_by_key = {
        p.match_key: (p.filament_color_id, p.filament_custom_hex) for p in existing_rows
    }
    new_keys = {mp.match_key for mp in result.parts}

    for key, row in existing_by_key.items():
        if key not in new_keys:
            session.delete(row)

    for mp in result.parts:
        prior_merge = existing_merge.get(mp.match_key)
        if prior_merge:
            if prior_merge.quantity_override is not None:
                mp.quantity_override = prior_merge.quantity_override
            mp.notes = prior_merge.notes or mp.notes
            mp.included = prior_merge.included

        prior_row = existing_by_key.get(mp.match_key)
        if prior_row:
            _apply_merge_to_existing_part(prior_row, mp)
            filament = filament_by_key.get(mp.match_key)
            if filament:
                prior_row.filament_color_id = filament[0]
                prior_row.filament_custom_hex = filament[1]
        else:
            row = merge_part_to_row(profile_id, mp)
            row.role = mp.role
            filament = filament_by_key.get(mp.match_key)
            if filament:
                row.filament_color_id = filament[0]
                row.filament_custom_hex = filament[1]
            session.add(row)

    session.flush()
    ensure_profile_progress(session, profile_id)


def list_projects(session: Session) -> list[Project]:
    return list(session.scalars(select(Project).order_by(Project.name)).all())


def list_profiles(session: Session) -> list[BuildProfile]:
    return list(session.scalars(select(BuildProfile).order_by(BuildProfile.name)).all())


def profile_part_counts(session: Session) -> dict[int, tuple[int, int]]:
    """Map profile_id -> (total_parts, included_parts)."""
    included_sum = func.sum(case((Part.included.is_(True), 1), else_=0))
    rows = session.execute(
        select(Part.profile_id, func.count(Part.id), included_sum).group_by(Part.profile_id)
    )
    return {int(pid): (int(total), int(inc or 0)) for pid, total, inc in rows}


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


def part_to_display_dict(
    part: Part,
    session: Session | None = None,
    *,
    colors_by_id: dict | None = None,
    print_units_by_id: dict[int, list[bool]] | None = None,
) -> dict:
    """Snapshot Part fields while session is open (avoids DetachedInstanceError in UI)."""
    from print_partner.core.ambrosia_catalog import AmbrosiaColor, get_color_by_id
    from print_partner.core.filament_color_resolve import resolve_part_filament_hex
    from print_partner.core.print_progress import get_print_units

    filament_id = part.filament_color_id
    color: AmbrosiaColor | None = None
    if filament_id:
        if colors_by_id is not None:
            color = colors_by_id.get(filament_id)
        else:
            color = get_color_by_id(filament_id)
    resolved_hex = resolve_part_filament_hex(part)
    qty = max(1, part.quantity_effective)
    print_units: list[bool] = []
    printed_count = 0
    if print_units_by_id is not None and part.id in print_units_by_id:
        print_units = print_units_by_id[part.id]
        printed_count = sum(print_units)
    elif session is not None:
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
        "filament_custom_hex": part.filament_custom_hex,
        "filament_display": color.combo_label if color else "",
        "filament_hex": resolved_hex,
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
    custom_hex: str | None = None,
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
        part.filament_custom_hex = custom_hex
        count += 1
    return count
