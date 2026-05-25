"""Support / donation link constants."""

from print_partner.support_links import KOFI_URL


def test_kofi_url() -> None:
    assert KOFI_URL == "https://ko-fi.com/poitee"
    assert KOFI_URL.startswith("https://ko-fi.com/")
