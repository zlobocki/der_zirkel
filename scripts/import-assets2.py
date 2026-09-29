#!/usr/bin/env python3
"""Copy the replacement board and unit art out of assets2.zip.

The uploaded SVGs are A4 pages. The board is framed to the original
354.012 by 242.604 view, using London as the reference. Each icon is
framed to the drawing so it can sit on a map slot.
"""

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "assets2.zip"
TARGET = ROOT / "web/public/art"

ICON_VIEWBOX = {
    "army_austria-hungary.svg": "174.900 252.900 10.200 6.700",
    "army_britain.svg": "125.400 175.400 10.200 6.700",
    "army_france.svg": "81.400 137.900 10.200 6.700",
    "army_germany.svg": "134.900 171.400 10.700 6.700",
    "army_italy.svg": "169.900 254.900 10.200 6.200",
    "army_russia.svg": "111.400 191.400 10.700 6.700",
    "factory_land.svg": "119.400 123.400 7.200 7.200",
    "factory_sea.svg": "116.400 108.900 7.200 7.200",
    "fleet_austria-hungary.svg": "135.400 209.400 11.700 6.700",
    "fleet_britain.svg": "127.900 179.400 11.700 6.700",
    "fleet_france.svg": "123.400 168.900 11.700 6.700",
    "fleet_germany.svg": "114.900 196.900 11.700 7.200",
    "fleet_italy.svg": "173.900 207.400 12.200 6.700",
    "fleet_russia.svg": "137.900 180.400 11.700 6.700",
}


def frame(text: str, view_box: str, width: str, height: str) -> str:
    text = text.replace('width="210mm"', f'width="{width}"', 1)
    text = text.replace('height="297mm"', f'height="{height}"', 1)
    text = text.replace('viewBox="0 0 210 297"', f'viewBox="{view_box}"', 1)
    if f'viewBox="{view_box}"' not in text:
        raise SystemExit("assets2 SVG no longer has the expected page size")
    return text


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ARCHIVE) as archive:
        board = archive.read("assets2/game_board_v3.svg").decode("utf-8")
        (TARGET / "game_board_v3.svg").write_text(
            frame(board, "-397.16040 265.60029 354.01199 242.604", "354.01199", "242.604"),
            encoding="utf-8",
        )
        for name, view_box in ICON_VIEWBOX.items():
            width, height = view_box.split()[2:]
            icon = archive.read(f"assets2/{name}").decode("utf-8")
            (TARGET / name).write_text(frame(icon, view_box, width, height), encoding="utf-8")


if __name__ == "__main__":
    main()
