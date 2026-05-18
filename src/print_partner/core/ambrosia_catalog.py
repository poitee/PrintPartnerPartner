"""West3D Ambrosia filament catalog — sync from Shopify, local cache, bundled fallback."""

from __future__ import annotations

import json
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from importlib import resources
from pathlib import Path
from typing import Any, Callable, Optional

import httpx

from print_partner.config import settings

COLLECTION_URL = "https://west3d.com/collections/ambrosia-filament/products.json?limit=250"
SIZE_PREFIX = re.compile(r"^(1kg|2kg|5kg)\s*/\s*", re.IGNORECASE)
DEFAULT_HEX = "#888888"
MAX_SWATCH_WORKERS = 8


@dataclass(frozen=True)
class AmbrosiaColor:
    id: str
    display_name: str
    product_line: str
    shopify_product_id: int
    shopify_variant_id: int
    swatch_url: str
    hex: str

    @property
    def combo_label(self) -> str:
        return f"{self.product_line} · {self.display_name}"


@dataclass
class AmbrosiaCatalog:
    synced_at: str
    source: str
    colors: list[AmbrosiaColor]

    def by_id(self) -> dict[str, AmbrosiaColor]:
        return {c.id: c for c in self.colors}


def catalog_cache_path() -> Path:
    settings.ensure_dirs()
    catalog_dir = settings.data_dir / "catalog"
    catalog_dir.mkdir(parents=True, exist_ok=True)
    return catalog_dir / "ambrosia.json"


def _slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "unknown"


def normalize_variant_title(title: str) -> str:
    t = SIZE_PREFIX.sub("", title.strip())
    return t


def short_product_line(product_title: str) -> str:
    """Derive a short line name from Shopify product title."""
    line = product_title
    if " - " in line:
        line = line.split(" - ", 1)[0]
    line = line.replace("AMBROSIA ", "").replace("Ambrosia ", "").strip()
    line = re.sub(r"\s+Filament of the Gods.*$", "", line, flags=re.IGNORECASE)
    line = re.sub(r"\s+1KG.*$", "", line, flags=re.IGNORECASE)
    line = re.sub(r"\s+1\.75mm.*$", "", line, flags=re.IGNORECASE)
    return line.strip() or product_title[:48]


def line_slug_from_title(product_title: str) -> str:
    return _slug(short_product_line(product_title))


def make_color_id(line_slug: str, display_name: str) -> str:
    return f"{line_slug}::{_slug(display_name)}"


def parse_shopify_products(products: list[dict[str, Any]]) -> list[AmbrosiaColor]:
    colors: list[AmbrosiaColor] = []
    seen: set[str] = set()
    for product in products:
        product_id = int(product["id"])
        product_title = product.get("title") or ""
        line = short_product_line(product_title)
        line_slug = line_slug_from_title(product_title)
        for variant in product.get("variants") or []:
            raw_title = variant.get("title") or variant.get("option1") or ""
            if not raw_title or raw_title == "Default Title":
                continue
            display = normalize_variant_title(raw_title)
            cid = make_color_id(line_slug, display)
            if cid in seen:
                continue
            seen.add(cid)
            swatch_url = ""
            featured = variant.get("featured_image")
            if isinstance(featured, dict):
                swatch_url = featured.get("src") or ""
            elif isinstance(featured, str):
                swatch_url = featured
            if not swatch_url and product.get("images"):
                swatch_url = product["images"][0].get("src") or ""
            colors.append(
                AmbrosiaColor(
                    id=cid,
                    display_name=display,
                    product_line=line,
                    shopify_product_id=product_id,
                    shopify_variant_id=int(variant["id"]),
                    swatch_url=swatch_url,
                    hex=DEFAULT_HEX,
                )
            )
    colors.sort(key=lambda c: (c.product_line.lower(), c.display_name.lower()))
    return colors


def _is_chromatic_pixel(p: tuple[int, int, int], *, min_spread: int = 28) -> bool:
    r, g, b = p
    if max(r, g, b) - min(r, g, b) < min_spread:
        return False
    if min(r, g, b) > 235:
        return False
    return True


def sample_hex_from_image(data: bytes) -> str:
    from io import BytesIO

    from PIL import Image

    img = Image.open(BytesIO(data)).convert("RGB")
    w, h = img.size
    mx, my = int(w * 0.28), int(h * 0.28)
    img = img.crop((mx, my, w - mx, h - my))
    img = img.resize((48, 48), Image.Resampling.LANCZOS)
    pixels = [p for p in img.getdata() if _is_chromatic_pixel(p)]
    if not pixels:
        pixels = list(img.getdata())
    r = sum(p[0] for p in pixels) // len(pixels)
    g = sum(p[1] for p in pixels) // len(pixels)
    b = sum(p[2] for p in pixels) // len(pixels)
    return f"#{r:02x}{g:02x}{b:02x}"


def _fetch_swatch_hex(
    client: httpx.Client,
    url: str,
    prior_hex: str | None = None,
) -> str:
    if not url:
        return prior_hex or DEFAULT_HEX
    try:
        resp = client.get(url, timeout=15.0)
        resp.raise_for_status()
        return sample_hex_from_image(resp.content)
    except Exception:
        return prior_hex or DEFAULT_HEX


def enrich_colors_with_hex(
    colors: list[AmbrosiaColor],
    prior_by_id: dict[str, AmbrosiaColor] | None = None,
    on_progress: Callable[[int, int], None] | None = None,
) -> list[AmbrosiaColor]:
    prior = prior_by_id or {}
    total = len(colors)
    enriched: list[Optional[AmbrosiaColor]] = [None] * total

    def work(idx: int, color: AmbrosiaColor) -> tuple[int, AmbrosiaColor]:
        from print_partner.core.filament_color_resolve import (
            effective_filament_hex,
            is_weak_swatch_hex,
        )

        old = prior.get(color.id)
        if old and old.swatch_url == color.swatch_url and old.hex != DEFAULT_HEX:
            hex_val = old.hex
            if is_weak_swatch_hex(old.hex):
                hex_val = effective_filament_hex(old.hex, color.display_name, color.product_line) or old.hex
            return idx, AmbrosiaColor(
                id=color.id,
                display_name=color.display_name,
                product_line=color.product_line,
                shopify_product_id=color.shopify_product_id,
                shopify_variant_id=color.shopify_variant_id,
                swatch_url=color.swatch_url,
                hex=hex_val,
            )
        with httpx.Client(follow_redirects=True) as client:
            hex_val = _fetch_swatch_hex(client, color.swatch_url, old.hex if old else None)
        resolved = effective_filament_hex(hex_val, color.display_name, color.product_line) or hex_val
        return idx, AmbrosiaColor(
            id=color.id,
            display_name=color.display_name,
            product_line=color.product_line,
            shopify_product_id=color.shopify_product_id,
            shopify_variant_id=color.shopify_variant_id,
            swatch_url=color.swatch_url,
            hex=resolved,
        )

    with ThreadPoolExecutor(max_workers=MAX_SWATCH_WORKERS) as pool:
        futures = {pool.submit(work, i, c): i for i, c in enumerate(colors)}
        done = 0
        for fut in as_completed(futures):
            idx, color = fut.result()
            enriched[idx] = color
            done += 1
            if on_progress:
                on_progress(done, total)
    return [c for c in enriched if c is not None]


def catalog_to_dict(catalog: AmbrosiaCatalog) -> dict[str, Any]:
    return {
        "synced_at": catalog.synced_at,
        "source": catalog.source,
        "colors": [asdict(c) for c in catalog.colors],
    }


def _color_with_effective_hex(c: dict[str, Any]) -> AmbrosiaColor:
    from print_partner.core.filament_color_resolve import effective_filament_hex

    raw_hex = c.get("hex") or DEFAULT_HEX
    display = c.get("display_name") or ""
    line = c.get("product_line") or ""
    hex_val = effective_filament_hex(raw_hex, display, line) or raw_hex
    return AmbrosiaColor(
        id=c["id"],
        display_name=display,
        product_line=line,
        shopify_product_id=int(c["shopify_product_id"]),
        shopify_variant_id=int(c["shopify_variant_id"]),
        swatch_url=c.get("swatch_url") or "",
        hex=hex_val,
    )


def catalog_from_dict(data: dict[str, Any]) -> AmbrosiaCatalog:
    colors = [_color_with_effective_hex(c) for c in data.get("colors") or []]
    return AmbrosiaCatalog(
        synced_at=data.get("synced_at") or "",
        source=data.get("source") or "unknown",
        colors=colors,
    )


def save_catalog(catalog: AmbrosiaCatalog, path: Path | None = None) -> Path:
    dest = path or catalog_cache_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(catalog_to_dict(catalog), indent=2), encoding="utf-8")
    return dest


def load_catalog_from_path(path: Path) -> AmbrosiaCatalog | None:
    if not path.is_file():
        return None
    try:
        return catalog_from_dict(json.loads(path.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        return None


def load_bundled_fallback() -> AmbrosiaCatalog | None:
    try:
        pkg = resources.files("print_partner.data")
        ref = pkg / "ambrosia_fallback.json"
        with resources.as_file(ref) as path:
            return load_catalog_from_path(path)
    except (FileNotFoundError, ModuleNotFoundError):
        return None


def load_catalog() -> AmbrosiaCatalog:
    cached = load_catalog_from_path(catalog_cache_path())
    if cached and cached.colors:
        return cached
    bundled = load_bundled_fallback()
    if bundled and bundled.colors:
        return bundled
    return AmbrosiaCatalog(synced_at="", source="empty", colors=[])


def get_color_by_id(color_id: str | None) -> AmbrosiaColor | None:
    if not color_id:
        return None
    return load_catalog().by_id().get(color_id)


def resolve_filament_hex(filament_color_id: str | None, role: str) -> str | None:
    """Return mesh hex for preview/thumbnails, or None to use role defaults."""
    from print_partner.core.filament_color_resolve import effective_filament_hex
    from print_partner.core.mesh_color import normalize_mesh_hex

    del role  # reserved — filament color overrides role tint
    if not filament_color_id:
        return None
    color = get_color_by_id(filament_color_id)
    if not color:
        return None
    resolved = effective_filament_hex(color.hex, color.display_name, color.product_line)
    return normalize_mesh_hex(resolved)


def sync_ambrosia_catalog(
    *,
    force: bool = False,
    on_progress: Callable[[int, int], None] | None = None,
) -> AmbrosiaCatalog:
    """Fetch collection from West3D Shopify and write local cache."""
    del force  # reserved for future incremental sync
    with httpx.Client(follow_redirects=True, timeout=30.0) as client:
        resp = client.get(COLLECTION_URL)
        resp.raise_for_status()
        payload = resp.json()
    products = payload.get("products") or []
    colors = parse_shopify_products(products)
    prior = load_catalog_from_path(catalog_cache_path())
    prior_by_id = prior.by_id() if prior else {}
    colors = enrich_colors_with_hex(colors, prior_by_id, on_progress=on_progress)
    catalog = AmbrosiaCatalog(
        synced_at=datetime.now(timezone.utc).isoformat(),
        source="west3d_shopify",
        colors=colors,
    )
    save_catalog(catalog)
    return catalog


def catalog_status_text(catalog: AmbrosiaCatalog | None = None) -> str:
    cat = catalog or load_catalog()
    if not cat.colors:
        return "No Ambrosia colors loaded — click Refresh"
    synced = cat.synced_at[:10] if cat.synced_at else "bundled"
    return f"{len(cat.colors)} colors · {cat.source} · {synced}"
