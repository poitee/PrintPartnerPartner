# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Print Partner."""

import sys
from pathlib import Path

block_cipher = None
root = Path(SPECPATH).parent.parent
src = root / "src"

a = Analysis(
    [str(src / "print_partner" / "__main__.py")],
    pathex=[str(src)],
    binaries=[],
    datas=[],
    hiddenimports=[
        "print_partner",
        "print_partner.app",
        "print_partner.config",
        "print_partner.core.parsers",
        "print_partner.core.scanner",
        "print_partner.core.merge",
        "print_partner.core.git_sync",
        "print_partner.core.export_html",
        "print_partner.db.models",
        "print_partner.db.session",
        "print_partner.ui.main_window",
        "print_partner.ui.project_library",
        "print_partner.ui.profile_composer",
        "print_partner.ui.diff_view",
        "print_partner.ui.stl_viewer",
        "print_partner.ui.docs_panel",
        "pyvistaqt",
        "vtkmodules",
    ],
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
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="print-partner",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

app = BUNDLE(
    exe,
    name="Print Partner.app",
    icon=None,
    bundle_identifier="com.printpartner.app",
) if sys.platform == "darwin" else exe
