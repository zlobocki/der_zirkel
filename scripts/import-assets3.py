#!/usr/bin/env python3
"""Frame the assets3 board and copy the replacement army and fleet icons.

The board is the same 354 by 242 view as the overlay, shifted on an A4 page.
Factories in this archive match the previous crop, so those files stay.
"""

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "assets3.zip"
TARGET = ROOT / "web/public/art"

BOARD_VIEW = "-397.16064 265.60022 354.01248 242.60411"
ICONS = [
    "army_austria-hungary.svg",
    "army_britain.svg",
    "army_france.svg",
    "army_germany.svg",
    "army_italy.svg",
    "army_russia.svg",
    "fleet_austria-hungary.svg",
    "fleet_britain.svg",
    "fleet_france.svg",
    "fleet_germany.svg",
    "fleet_italy.svg",
    "fleet_russia.svg",
]


def frame_board(text: str) -> str:
    text = text.replace('width="210mm"', 'width="354.01248"', 1)
    text = text.replace('height="297mm"', 'height="242.60411"', 1)
    text = text.replace('viewBox="0 0 210 297"', f'viewBox="{BOARD_VIEW}"', 1)
    if f'viewBox="{BOARD_VIEW}"' not in text:
        raise SystemExit("assets3 board no longer has the expected page size")
    return text


def frame_icon(text: str) -> str:
    text = text.replace('width="12mm"', 'width="12"', 1)
    text = text.replace('height="12mm"', 'height="12"', 1)
    if 'viewBox="0 0 12 12"' not in text:
        raise SystemExit("assets3 icon is not a 12mm token")
    return text


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ARCHIVE) as archive:
        board = archive.read("assets3/game_board_v3.svg").decode("utf-8")
        (TARGET / "game_board_v3.svg").write_text(frame_board(board), encoding="utf-8")
        for name in ICONS:
            icon = archive.read(f"assets3/{name}").decode("utf-8")
            (TARGET / name).write_text(frame_icon(icon), encoding="utf-8")


if __name__ == "__main__":
    main()
