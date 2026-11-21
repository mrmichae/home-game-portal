#!/usr/bin/env python3
"""Generate the checked-in tvOS image stacks and top-shelf artwork."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "App" / "Assets.xcassets"
BRAND = CATALOG / "App Icon & Top Shelf Image.brandassets"

INK = (10, 10, 14, 255)
RED = (229, 9, 20, 255)
WHITE = (255, 255, 255, 255)


GLYPHS = {
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "G": ("01111", "10000", "10000", "10111", "10001", "10001", "01110"),
    "H": ("10001", "10001", "10001", "11111", "10001", "10001", "10001"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "M": ("10001", "11011", "10101", "10101", "10001", "10001", "10001"),
    "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "P": ("11110", "10001", "10001", "11110", "10000", "10000", "10000"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
}


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def metadata() -> dict[str, object]:
    return {"author": "xcode", "version": 1}


def background(size: tuple[int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGBA", size, INK)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / max(height - 1, 1)
        color = (int(18 - 8 * t), int(18 - 8 * t), int(25 - 11 * t), 255)
        draw.line((0, y, width, y), fill=color)
    spacing = max(width // 18, 1)
    grid = (255, 255, 255, 10)
    for x in range(-height, width + height, spacing):
        draw.line((x, 0, x - height, height), fill=grid, width=max(width // 1000, 1))
    return image


def middle(size: tuple[int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    mark_width = int(height * 0.64)
    left = (width - mark_width) // 2
    top = int(height * 0.18)
    box = (left, top, left + mark_width, top + mark_width)
    radius = int(mark_width * 0.22)
    glow_draw.rounded_rectangle(box, radius=radius, fill=(229, 9, 20, 150))
    blur = glow.filter(ImageFilter.GaussianBlur(max(height // 20, 1)))
    image.alpha_composite(blur)
    ImageDraw.Draw(image).rounded_rectangle(box, radius=radius, fill=RED)
    return image


def foreground(size: tuple[int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    center = width // 2
    top = int(height * 0.31)
    short_top = int(height * 0.39)
    bottom = int(height * 0.69)
    bar_width = max(int(height * 0.065), 2)
    gap = max(int(height * 0.11), 3)
    for x, y in ((center - gap, short_top), (center, top), (center + gap, short_top)):
        draw.rounded_rectangle(
            (x - bar_width // 2, y, x + bar_width // 2, bottom),
            radius=bar_width // 2,
            fill=WHITE,
        )
    return image


def draw_pixel_text(image: Image.Image, text: str, y: int, scale: int) -> None:
    draw = ImageDraw.Draw(image)
    character_width = 5 * scale
    space = 3 * scale
    total = sum(space if c == " " else character_width + scale for c in text) - scale
    x = (image.width - total) // 2
    for character in text:
        if character == " ":
            x += space
            continue
        for row, bits in enumerate(GLYPHS[character]):
            for column, bit in enumerate(bits):
                if bit == "1":
                    draw.rectangle(
                        (x + column * scale, y + row * scale,
                         x + (column + 1) * scale - 1, y + (row + 1) * scale - 1),
                        fill=WHITE,
                    )
        x += character_width + scale


def composite_art(size: tuple[int, int], include_title: bool = False) -> Image.Image:
    image = background(size)
    image.alpha_composite(middle(size))
    image.alpha_composite(foreground(size))
    if include_title:
        scale = max(image.width // 190, 4)
        draw_pixel_text(image, "HOME GAME PORTAL", int(image.height * 0.79), scale)
    return image.convert("RGB")


def layer_art(kind: str, size: tuple[int, int]) -> Image.Image:
    return {"Back": background, "Middle": middle, "Front": foreground}[kind](size)


def make_stack(name: str, sizes: list[tuple[str, tuple[int, int]]]) -> None:
    stack = BRAND / f"{name}.imagestack"
    layers = ["Front", "Middle", "Back"]
    write_json(stack / "Contents.json", {
        "layers": [{"filename": f"{layer}.imagestacklayer"} for layer in layers],
        "info": metadata(),
    })
    for layer in layers:
        layer_root = stack / f"{layer}.imagestacklayer"
        write_json(layer_root / "Contents.json", {"info": metadata()})
        images = []
        for scale, dimensions in sizes:
            filename = f"{layer.lower()}@{scale}.png"
            image_root = layer_root / "Content.imageset"
            image_root.mkdir(parents=True, exist_ok=True)
            layer_art(layer, dimensions).save(image_root / filename, optimize=True)
            images.append({"filename": filename, "idiom": "tv", "scale": scale})
        write_json(layer_root / "Content.imageset" / "Contents.json", {
            "images": images,
            "info": metadata(),
        })


def make_top_shelf(name: str, sizes: list[tuple[str, tuple[int, int]]]) -> None:
    root = BRAND / f"{name}.imageset"
    images = []
    for scale, dimensions in sizes:
        filename = f"{name.lower().replace(' ', '-')}@{scale}.png"
        root.mkdir(parents=True, exist_ok=True)
        composite_art(dimensions, include_title=True).save(root / filename, optimize=True)
        images.append({"filename": filename, "idiom": "tv", "scale": scale})
    write_json(root / "Contents.json", {"images": images, "info": metadata()})


def main() -> None:
    write_json(CATALOG / "Contents.json", {"info": metadata()})
    write_json(BRAND / "Contents.json", {
        "assets": [
            {"filename": "App Icon - App Store.imagestack", "idiom": "tv", "role": "primary-app-icon", "size": "1280x768"},
            {"filename": "App Icon.imagestack", "idiom": "tv", "role": "primary-app-icon", "size": "400x240"},
            {"filename": "Top Shelf Image Wide.imageset", "idiom": "tv", "role": "top-shelf-image-wide", "size": "2320x720"},
            {"filename": "Top Shelf Image.imageset", "idiom": "tv", "role": "top-shelf-image", "size": "1920x720"},
        ],
        "info": metadata(),
    })
    make_stack("App Icon - App Store", [("1x", (1280, 768))])
    make_stack("App Icon", [("1x", (400, 240)), ("2x", (800, 480))])
    make_top_shelf("Top Shelf Image", [("1x", (1920, 720)), ("2x", (3840, 1440))])
    make_top_shelf("Top Shelf Image Wide", [("1x", (2320, 720)), ("2x", (4640, 1440))])


if __name__ == "__main__":
    main()
