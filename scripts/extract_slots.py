#!/usr/bin/env python3
"""Read the overlay labels and write board slot coordinates for the client."""

import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OVERLAY = ROOT / "web/public/art-src/Assets/game_board_overlay.svg"
OUTPUT = ROOT / "web/src/board/slots.json"
SVG = "{http://www.w3.org/2000/svg}"
KEEP = re.compile(
    r"^(LR\d+_.+|SR\d+_.+|score_\d+|tax_.+|Rondelcenter|(ah|uk|fra|ger|ita|rus)_(owner|pawn|tax|treasury))$"
)


def parse_transform(value: str | None):
    if not value:
        return []
    operations = []
    for match in re.finditer(r"(matrix|translate|rotate|scale)\(([^)]*)\)", value):
        numbers = [float(item) for item in re.findall(r"[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?", match.group(2))]
        operations.append((match.group(1), numbers))
    return operations


def apply_operation(operation, x: float, y: float):
    kind, numbers = operation
    if kind == "translate":
        return x + (numbers[0] if numbers else 0), y + (numbers[1] if len(numbers) > 1 else 0)
    if kind == "scale":
        sx = numbers[0] if numbers else 1
        sy = numbers[1] if len(numbers) > 1 else sx
        return x * sx, y * sy
    if kind == "rotate":
        angle = math.radians(numbers[0] if numbers else 0)
        cosine, sine = math.cos(angle), math.sin(angle)
        if len(numbers) >= 3:
            cx, cy = numbers[1], numbers[2]
            x, y = x - cx, y - cy
            return x * cosine - y * sine + cx, x * sine + y * cosine + cy
        return x * cosine - y * sine, x * sine + y * cosine
    if kind == "matrix" and len(numbers) >= 6:
        a, b, c, d, e, f = numbers[:6]
        return a * x + c * y + e, b * x + d * y + f
    return x, y


def text_of(element) -> str:
    parts = [node.text for node in element.iter(SVG + "tspan") if node.text]
    if not parts and element.text:
        parts.append(element.text)
    return "".join(parts).replace("\n", "").strip()


def main() -> None:
    if not OVERLAY.exists():
        raise SystemExit(f"Missing overlay at {OVERLAY}. Extract the asset zip first.")
    root = ET.parse(OVERLAY).getroot()
    parent = {child: node for node in root.iter() for child in list(node)}
    view_box = [float(part) for part in root.get("viewBox", "0 0 354.01199 242.604").split()[2:4]]
    slots = {}
    for element in root.iter(SVG + "text"):
        label = text_of(element)
        if not KEEP.match(label):
            continue
        x = float(element.get("x") or 0)
        y = float(element.get("y") or 0)
        spans = list(element.findall(SVG + "tspan"))
        if spans and spans[0].get("x"):
            x = float(spans[0].get("x"))
            y = float(spans[0].get("y") or y)
        node = element
        while node is not None:
            for operation in parse_transform(node.get("transform")):
                x, y = apply_operation(operation, x, y)
            node = parent.get(node)
        slots[label] = [round(x, 2), round(y, 2)]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({"viewBox": view_box, "slots": slots}, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(slots)} slots to {OUTPUT}")


if __name__ == "__main__":
    main()
