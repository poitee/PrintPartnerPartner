"""Serialize VTK/PyVista operations (Qt interactor vs offscreen thumbnails)."""

from __future__ import annotations

import threading

_LOCK = threading.RLock()


def vtk_lock():
    return _LOCK
