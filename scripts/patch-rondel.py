#!/usr/bin/env python3
"""Browsers do not draw text along a circle inside an SVG image. Use a path."""

from pathlib import Path

BOARD = Path(__file__).resolve().parents[1] / "web/public/art/game_board.svg"

OLD_CIRCLE = """<circle
       style="fill:none;fill-opacity:1;stroke:#000000;stroke-width:0;stroke-dasharray:none"
       id="path23149"
       cx="70.153328"
       cy="29.072065"
       r="20.478748" />"""

PATH = """<path
       style="fill:none;stroke:none"
       id="path23149"
       d="M 70.153328,8.593317 a 20.478748,20.478748 0 1 1 -0.01,0" />"""


def main() -> None:
    if not BOARD.exists():
        return
    text = BOARD.read_text(encoding="utf-8")
    if OLD_CIRCLE in text:
        text = text.replace(OLD_CIRCLE, PATH, 1)
    if 'href="#path23149"' not in text and 'xlink:href="#path23149"' in text:
        text = text.replace(
            'xlink:href="#path23149"',
            'href="#path23149" xlink:href="#path23149"',
            1,
        )
    old_style = "font-family:'Germania One';-inkscape-font-specification:'Germania One';"
    new_style = "font-family:'Germania One', Arial, sans-serif;-inkscape-font-specification:'Germania One';"
    if old_style in text:
        text = text.replace(old_style, new_style, 1)
    BOARD.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
