#!/usr/bin/env python3
"""Frame the uploaded board so it matches the original 354.012 by 242.604 view.

The v2 file is the same artwork shifted on an A4 page, with the rondel drawn
from a PNG. London is the reference point for that shift.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "game_board_v2.svg"
TARGET = ROOT / "web/public/art/game_board_v2.svg"

VIEWBOX = 'viewBox="-398.49752 258.75733 354.01199 242.604"'


def main() -> None:
    text = SOURCE.read_text(encoding="utf-8")
    text = text.replace('width="210mm"', 'width="354.01199"', 1)
    text = text.replace('height="297mm"', 'height="242.604"', 1)
    text = text.replace('viewBox="0 0 210 297"', VIEWBOX, 1)
    if VIEWBOX not in text:
        raise SystemExit("game_board_v2.svg no longer has the expected page size")
    TARGET.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
