# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Print Partner (onedir bundle)."""

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None
# SPECPATH is the directory containing this spec (packaging/), not the repo root.
root = Path(SPECPATH).parent
src = root / "src"
data_dir = src / "print_partner" / "data"

_hiddenimports = [
    "print_partner",
    "print_partner.app",
    "print_partner.config",
    "print_partner.core.parsers",
    "print_partner.core.scanner",
    "print_partner.core.merge",
    "print_partner.core.git_sync",
    "print_partner.core.export_html",
    "print_partner.core.export_stl_zip",
    "print_partner.core.export_3mf",
    "lib3mf",
    "print_partner.core.parts_tree",
    "print_partner.core.path_tree",
    "print_partner.core.repo_docs",
    "print_partner.db.models",
    "print_partner.db.session",
    "print_partner.ui.main_window",
    "print_partner.ui.workflow_strip",
    "print_partner.ui.kit_library",
    "print_partner.ui.remote_check_worker",
    "print_partner.core.datetime_display",
    "print_partner.ui.ai_suggestions_dialog",
    "print_partner.core.ai_capabilities",
    "print_partner.core.ai_executor",
    "print_partner.core.ai_context",
    "print_partner.core.ai_client",
    "print_partner.ui.empty_state",
    "print_partner.ui.first_run_dialog",
    "print_partner.ui.project_library",
    "print_partner.ui.profile_composer",
    "print_partner.ui.composer.parts_view",
    "print_partner.ui.composer.kit_actions",
    "print_partner.ui.composer.ai_integration",
    "print_partner.ui.kit_submode_strip",
    "print_partner.ui.toast",
    "print_partner.ui.path_picker",
    "print_partner.core.checklist_export_css",
    "print_partner.core.export_kit_bundle",
    "print_partner.logging_setup",
    "print_partner.ui.profile_parts_panel",
    "print_partner.ui.profile_suggestions_panel",
    "print_partner.ui.profile_layers_panel",
    "print_partner.ui.build_wizard",
    "print_partner.ui.parts_curation_widget",
    "print_partner.ui.print_checklist_widget",
    "print_partner.ui.filament_picker_widget",
    "print_partner.ui.repo_import_dialog",
    "print_partner.ui.folder_table_layout",
    "print_partner.ui.diff_view",
    "print_partner.ui.stl_viewer",
    "print_partner.ui.docs_panel",
    "print_partner.ui.repo_browse_tree",
    "print_partner.ui.parts_tree_widget",
    "print_partner.ui.sync_worker",
    "print_partner.ui.recompute_worker",
    "print_partner.ui.catalog_sync_worker",
    "print_partner.ui.export_worker",
    "print_partner.ui.thumbnail_cache_worker",
    "print_partner.ui.tabs.source_tab",
    "print_partner.ui.app_style",
    "print_partner.ui.ai_assistant_panel",
    "print_partner.ui.ai_settings_dialog",
    "print_partner.ui.ai_worker",
    "print_partner.core.ai_config",
    "print_partner.core.ai_context",
    "print_partner.core.ai_client",
    "pyvista",
    "trimesh",
    "numpy",
    "numpy.core._multiarray_umath",
]

_binaries: list = []
_datas: list = [
    (str(data_dir / "ambrosia_fallback.json"), "print_partner/data"),
    (str(data_dir / "kofi_cup.svg"), "print_partner/data"),
]

_legal_files = ["LICENSE", "LICENSE-SUMMARY.md", "THIRD_PARTY_NOTICES.md", "COMMERCIAL.md"]
for _name in _legal_files:
    _p = root / _name
    if _p.is_file():
        _datas.append((str(_p), "."))


for _pkg in ("numpy", "pyvista", "lib3mf"):
    _d, _b, _h = collect_all(_pkg)
    _datas += _d
    _binaries += _b
    _hiddenimports += _h

_hiddenimports += collect_submodules("vtkmodules")

a = Analysis(
    [str(src / "print_partner" / "__main__.py")],
    pathex=[str(src)],
    binaries=_binaries,
    datas=_datas,
    hiddenimports=_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="print-partner",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="Print Partner",
)

app = (
    BUNDLE(
        coll,
        name="Print Partner.app",
        icon=None,
        bundle_identifier="com.printpartner.app",
    )
    if sys.platform == "darwin"
    else coll
)
