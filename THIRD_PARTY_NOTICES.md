# Third-party notices

Print Partner includes open-source software and optional external tools. This file summarizes licenses for **direct runtime dependencies** (as declared in `pyproject.toml`). Transitive dependencies are also bundled in release builds; run `pip-licenses` in the project virtual environment for a full list.

## Inspiration

Print Partner’s workflow is inspired by [Annex Engineering](https://github.com/Annex-Engineering) (used with permission). See [ATTRIBUTION.md](ATTRIBUTION.md). Print Partner application source by Chad Lynch is licensed under the [Print Partner Non-Commercial Software License](LICENSE).

## Python packages (direct dependencies)

| Package | Version | License | URL |
|---------|---------|---------|-----|
| GitPython | 3.1.50 | BSD-3-Clause | https://github.com/gitpython-developers/GitPython |
| Jinja2 | 3.1.6 | BSD-3-Clause | https://github.com/pallets/jinja/ |
| Markdown | 3.10.2 | BSD-3-Clause | https://Python-Markdown.github.io/ |
| Pillow | 12.2.0 | MIT-CMU | https://python-pillow.github.io/ |
| SQLAlchemy | 2.0.49 | MIT | https://www.sqlalchemy.org |
| httpx | 0.28.1 | BSD-3-Clause | https://github.com/encode/httpx |
| lib3mf | 2.5.0 | BSD-3-Clause | (3MF Consortium lib3mf) |
| numpy | 1.26.4 | BSD-3-Clause | https://numpy.org |
| pydantic-settings | 2.14.1 | MIT | https://github.com/pydantic/pydantic-settings |
| pyvista | 0.48.4 | MIT | https://github.com/pyvista/pyvista |
| RapidFuzz | 3.14.5 | MIT | https://github.com/rapidfuzz/RapidFuzz |
| trimesh | 4.12.2 | MIT | https://github.com/mikedh/trimesh |

Versions reflect a typical release build environment; exact versions may vary slightly by platform wheel.

## PyVista and VTK

Thumbnails and 3D preview use **PyVista**, which depends on **VTK**. See PyVista and VTK project repositories for their license terms (BSD-style).

## Optional external tool: stl-thumb

If installed on your system `PATH`, Print Partner may invoke **stl-thumb** for faster STL thumbnails:

- Project: https://github.com/unlimitedbacon/stl-thumb
- License: MIT

Print Partner does not bundle stl-thumb; install it separately if desired.

## User-provided content

STL files, Git repositories, and kit data you import remain subject to **their own** licenses and terms. Print Partner does not claim ownership of your models or third-party repo content.

## Printer preset names

Built-in printer presets use common printer model names for bed-size hints only. Print Partner is **not affiliated with or endorsed by** any printer manufacturer (including names such as Bambu Lab, Prusa Research, or Voron Design).

## Print Partner license

Application source code by Chad Lynch is licensed under the **Print Partner Non-Commercial Software License**. See [LICENSE](LICENSE) (legal text), [LICENSE-SUMMARY.md](LICENSE-SUMMARY.md) (explanation), [ATTRIBUTION.md](ATTRIBUTION.md) (Annex inspiration credit), and [COMMERCIAL.md](COMMERCIAL.md) (commercial use).
