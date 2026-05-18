"""Tests for West3D Ambrosia catalog parsing and sync."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from print_partner.core.ambrosia_catalog import (
    catalog_from_dict,
    catalog_to_dict,
    enrich_colors_with_hex,
    load_catalog_from_path,
    make_color_id,
    normalize_variant_title,
    parse_shopify_products,
    save_catalog,
    short_product_line,
    sync_ambrosia_catalog,
)


FIXTURE = Path(__file__).parent / "fixtures" / "ambrosia_products_snippet.json"


def test_normalize_variant_title_strips_size():
    assert normalize_variant_title("2kg / Black") == "Black"
    assert normalize_variant_title("1kg / Voron Red") == "Voron Red"
    assert normalize_variant_title("Galactic Voron Red") == "Galactic Voron Red"


def test_short_product_line():
    title = "AMBROSIA PLA Filament of the Gods - 1KG Bambu AMS Friendly"
    assert short_product_line(title) == "PLA"


def test_make_color_id_stable():
    assert make_color_id("pla", "Voron Red") == "pla::voron-red"


def test_parse_shopify_products_snippet():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    colors = parse_shopify_products(data["products"])
    assert len(colors) == 3
    ids = {c.id for c in colors}
    assert "pla::voron-red" in ids
    assert "pla::black" in ids
    assert any("galactic" in c.product_line.lower() for c in colors)
    pla_voron = next(c for c in colors if c.display_name == "Voron Red" and c.product_line == "PLA")
    assert pla_voron.shopify_variant_id == 44020752253140
    assert pla_voron.swatch_url.endswith("voron_red.png")


def test_catalog_roundtrip(tmp_path: Path):
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    colors = parse_shopify_products(data["products"])
    from print_partner.core.ambrosia_catalog import AmbrosiaCatalog

    cat = AmbrosiaCatalog(synced_at="2026-01-01T00:00:00+00:00", source="test", colors=colors)
    path = tmp_path / "ambrosia.json"
    save_catalog(cat, path)
    loaded = load_catalog_from_path(path)
    assert loaded is not None
    assert len(loaded.colors) == len(colors)
    assert loaded.colors[0].id == colors[0].id


def test_enrich_reuses_prior_hex():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    colors = parse_shopify_products(data["products"])
    prior = {colors[0].id: colors[0]}
    prior_color = prior[colors[0].id]
    from print_partner.core.ambrosia_catalog import AmbrosiaColor

    prior_map = {
        prior_color.id: AmbrosiaColor(
            id=prior_color.id,
            display_name=prior_color.display_name,
            product_line=prior_color.product_line,
            shopify_product_id=prior_color.shopify_product_id,
            shopify_variant_id=prior_color.shopify_variant_id,
            swatch_url=prior_color.swatch_url,
            hex="#aabbcc",
        )
    }

    with patch("print_partner.core.ambrosia_catalog._fetch_swatch_hex", return_value="#010101"):
        enriched = enrich_colors_with_hex(colors, prior_map)

    first = next(c for c in enriched if c.id == prior_color.id)
    assert first.hex == "#aabbcc"


def test_sync_ambrosia_catalog_mocked(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "print_partner.core.ambrosia_catalog.catalog_cache_path",
        lambda: tmp_path / "ambrosia.json",
    )
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return payload

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url):
            return FakeResponse()

    with patch("print_partner.core.ambrosia_catalog.httpx.Client", FakeClient):
        with patch("print_partner.core.ambrosia_catalog._fetch_swatch_hex", return_value="#112233"):
            cat = sync_ambrosia_catalog()

    assert len(cat.colors) == 3
    assert (tmp_path / "ambrosia.json").is_file()
    reloaded = catalog_from_dict(json.loads((tmp_path / "ambrosia.json").read_text()))
    assert reloaded.colors[0].hex == "#112233"
