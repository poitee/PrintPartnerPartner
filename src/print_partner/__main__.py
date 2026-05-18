"""Entry point: python -m print_partner or print-partner CLI."""

from print_partner.app import run


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
