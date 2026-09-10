#!/usr/bin/env python3
"""Extract a reviewable alpha matte from baked checkerboard or flat-color art.

Uses only local Pillow/NumPy. Border-connected background is removed; enclosed
character whites are protected. Checker-textured holes are removed only in outer
silhouette zones, keeping central face/clothing details out of that heuristic.
"""

from __future__ import annotations

import argparse
from collections import deque
import hashlib
import json
from pathlib import Path
import platform

import numpy as np
from PIL import Image, ImageColor, ImageDraw, ImageFilter, __version__ as pillow_version


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as handle:
        for data in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(data)
    return result.hexdigest()


def flood_border(candidate: np.ndarray) -> np.ndarray:
    height, width = candidate.shape
    reached = np.zeros(candidate.shape, dtype=bool)
    queue = deque()
    for y, x in ([(0, x) for x in range(width)] + [(height - 1, x) for x in range(width)]
                 + [(y, 0) for y in range(height)] + [(y, width - 1) for y in range(height)]):
        if candidate[y, x] and not reached[y, x]:
            reached[y, x] = True
            queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= yy < height and 0 <= xx < width and candidate[yy, xx] and not reached[yy, xx]:
                reached[yy, xx] = True
                queue.append((yy, xx))
    return reached


def components(mask: np.ndarray):
    remaining = mask.copy()
    height, width = remaining.shape
    for y, x in zip(*np.nonzero(remaining)):
        if not remaining[y, x]:
            continue
        remaining[y, x] = False
        queue = deque([(int(y), int(x))])
        points = []
        while queue:
            yy, xx = queue.popleft()
            points.append((yy, xx))
            for ny, nx in ((yy - 1, xx), (yy + 1, xx), (yy, xx - 1), (yy, xx + 1)):
                if 0 <= ny < height and 0 <= nx < width and remaining[ny, nx]:
                    remaining[ny, nx] = False
                    queue.append((ny, nx))
        yield np.array(points, dtype=np.int32).T


def checker_levels(rgb: np.ndarray) -> tuple[float, float]:
    border = np.concatenate((rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3),
                             rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3)))
    values = border.mean(axis=1)
    first, second = np.percentile(values, [20, 80])
    for _ in range(8):
        lower = abs(values - first) <= abs(values - second)
        if lower.any() and (~lower).any():
            first, second = values[lower].mean(), values[~lower].mean()
    return float(min(first, second)), float(max(first, second))


def extend_edge_colors(rgb: np.ndarray, solid: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    # Derive fringe RGB from nearby interior art, never from baked checker pixels.
    core = np.array(Image.fromarray(solid.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(3))) > 0
    known = core.copy()
    colors = rgb.astype(np.float32).copy()
    height, width = solid.shape
    for _ in range(4):
        padded_colors = np.pad(colors * known[..., None], ((1, 1), (1, 1), (0, 0)))
        padded_known = np.pad(known.astype(np.float32), ((1, 1), (1, 1)))
        total = np.zeros_like(colors)
        count = np.zeros(solid.shape, dtype=np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            total += padded_colors[1 + dy:1 + dy + height, 1 + dx:1 + dx + width]
            count += padded_known[1 + dy:1 + dy + height, 1 + dx:1 + dx + width]
        new = ~known & (count > 0)
        colors[new] = total[new] / count[new, None]
        known |= new
    result = rgb.copy()
    fringe = (alpha > 0) & (alpha < 255) & known
    result[fringe] = np.clip(colors[fringe], 0, 255).astype(np.uint8)
    result[alpha == 0] = 0
    return result


def extract_frame(rgb: np.ndarray, args) -> tuple[np.ndarray, dict]:
    data = rgb.astype(np.float32)
    luminance = data.mean(axis=2)
    spread = data.max(axis=2) - data.min(axis=2)
    checker = args.background == "checker"
    if checker:
        candidate = (spread <= args.max_chroma) & (luminance >= args.min_gray)
        dark, light = checker_levels(data)
    else:
        key = np.array(ImageColor.getrgb(args.background), dtype=np.float32)
        candidate = np.linalg.norm(data - key, axis=2) <= args.tolerance
        # A saturated green/blue/red key can tint antialiased contours far outside
        # a simple RGB-distance threshold. Restrict this expansion to the key's
        # dominant channel; enclosed central character details remain guarded.
        key_channel = int(key.argmax())
        other_channels = [index for index in range(3) if index != key_channel]
        if key[key_channel] - key[other_channels].max() >= 80:
            spill = data[..., key_channel] - data[..., other_channels].max(axis=2)
            candidate |= spill > args.spill_threshold
        dark = light = None
    background = flood_border(candidate)
    foreground = ~background
    points = np.argwhere(foreground)
    if not len(points):
        raise ValueError("Matte extraction removed the entire frame")
    y0, x0 = points.min(axis=0)
    y1, x1 = points.max(axis=0)
    width, height = x1 - x0 + 1, y1 - y0 + 1
    holes = []
    protected = 0
    for yy, xx in components(candidate & ~background):
        area = len(yy)
        if area < args.min_hole or area > args.max_hole:
            continue
        cx, cy = float(xx.mean()), float(yy.mean())
        outer = (cy < y0 + 0.18 * height or cy > y0 + 0.70 * height
                 or cx < x0 + 0.18 * width or cx > x0 + 0.82 * width)
        if checker:
            low, high = np.percentile(luminance[yy, xx], [10, 90])
            matches = (dark - 70 <= low <= dark + 22 and light - 18 <= high <= light + 28
                       and high - low >= 25 and light - dark >= 25)
            remove = matches and (outer or args.hole_zones == "all")
        else:
            remove = outer or args.hole_zones == "all"
        if remove and args.hole_zones != "none":
            background[yy, xx] = True
            holes.append({"area": int(area), "bbox": [int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1]})
        else:
            protected += 1
    solid = ~background
    removed_specks = []
    for yy, xx in components(solid):
        if len(yy) < args.min_component:
            solid[yy, xx] = False
            removed_specks.append(len(yy))
    mask = Image.fromarray(solid.astype(np.uint8) * 255)
    alpha = np.array(mask.filter(ImageFilter.GaussianBlur(args.feather)) if args.feather else mask)
    rgb_out = extend_edge_colors(rgb, solid, alpha)
    rgba = np.dstack((rgb_out, alpha))
    bbox = Image.fromarray(alpha).getbbox()
    metrics = {"bbox": list(bbox) if bbox else None, "transparentPixels": int((alpha == 0).sum()),
               "opaquePixels": int((alpha == 255).sum()), "edgePixels": int(((alpha > 0) & (alpha < 255)).sum()),
               "checkerLevels": [round(dark, 2), round(light, 2)] if checker else None,
               "removedBackgroundHoles": holes, "protectedInteriorRegions": protected,
               "removedSpeckSizes": removed_specks}
    if not bbox or not metrics["transparentPixels"] or not metrics["opaquePixels"]:
        raise ValueError("Extraction did not produce both opaque artwork and transparent background")
    return rgba, metrics


def extract_file(path: Path, output: Path, args) -> dict:
    with Image.open(path) as opened:
        source = opened.convert("RGB")
    columns, rows = (int(item) for item in args.grid.lower().split("x"))
    if columns < 1 or rows < 1 or source.width % columns or source.height % rows:
        raise ValueError("Source image must divide exactly into the specified grid")
    width, height = source.width // columns, source.height // rows
    result = Image.new("RGBA", source.size)
    metrics = []
    for index in range(columns * rows):
        x, y = (index % columns) * width, (index // columns) * height
        frame, record = extract_frame(np.array(source.crop((x, y, x + width, y + height))), args)
        result.paste(Image.fromarray(frame), (x, y))
        metrics.append({"index": index, **record})
    output.parent.mkdir(parents=True, exist_ok=True)
    result.save(output, "PNG", optimize=True)
    return {"input": str(path), "inputSha256": digest(path), "output": str(output),
            "outputSha256": digest(output), "size": list(result.size), "mode": "RGBA",
            "alphaExtrema": list(result.getchannel("A").getextrema()), "frames": metrics}


def make_previews(records: list[dict], directory: Path, grid: str) -> list[str]:
    columns, rows = (int(item) for item in grid.lower().split("x"))
    count = columns * rows
    thumb = 256
    paths = []
    directory.mkdir(parents=True, exist_ok=True)
    for name, color in (("dark", "#151b28"), ("light", "#f8f6f0")):
        sheet = Image.new("RGB", (count * thumb, len(records) * (thumb + 28)), color)
        draw = ImageDraw.Draw(sheet)
        for row, record in enumerate(records):
            source = Image.open(record["output"]).convert("RGBA")
            width, height = source.width // columns, source.height // rows
            for index in range(count):
                x, y = index % columns * width, index // columns * height
                frame = source.crop((x, y, x + width, y + height))
                frame.thumbnail((thumb, thumb), Image.Resampling.LANCZOS)
                base = Image.new("RGBA", (thumb, thumb), color)
                base.alpha_composite(frame, ((thumb - frame.width) // 2, (thumb - frame.height) // 2))
                sheet.paste(base.convert("RGB"), (index * thumb, row * (thumb + 28) + 28))
            draw.text((12, row * (thumb + 28) + 7), Path(record["input"]).stem + " / alpha review only",
                      fill="#b9c4d9" if name == "dark" else "#36415b")
        path = directory / f"contact-{name}.png"
        sheet.save(path)
        paths.append(str(path))
    detail = Image.new("RGB", (1024, 512 * len(records)))
    for row, record in enumerate(records):
        source = Image.open(record["output"]).convert("RGBA")
        frame = source.crop((0, 0, source.width // columns, source.height // rows))
        frame.thumbnail((512, 512), Image.Resampling.LANCZOS)
        for column, color in enumerate(("#151b28", "#f8f6f0")):
            base = Image.new("RGBA", (512, 512), color)
            base.alpha_composite(frame, ((512 - frame.width) // 2, (512 - frame.height) // 2))
            detail.paste(base.convert("RGB"), (column * 512, row * 512))
    path = directory / "first-frame-detail.png"
    detail.save(path)
    paths.append(str(path))
    return paths


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--grid", default="3x2")
    parser.add_argument("--background", default="checker", help="checker or a fixed CSS/hex color")
    parser.add_argument("--max-chroma", type=float, default=14)
    parser.add_argument("--min-gray", type=float, default=90)
    parser.add_argument("--tolerance", type=float, default=55, help="RGB Euclidean tolerance for fixed backgrounds")
    parser.add_argument("--spill-threshold", type=float, default=16,
                        help="Dominant-channel excess treated as spill for saturated green/blue/red keys")
    parser.add_argument("--min-hole", type=int, default=18)
    parser.add_argument("--max-hole", type=int, default=1800)
    parser.add_argument("--hole-zones", choices=("outer", "all", "none"), default="outer")
    parser.add_argument("--min-component", type=int, default=20)
    parser.add_argument("--feather", type=float, default=0.45)
    args = parser.parse_args()
    if args.feather < 0 or args.feather > 1.5:
        parser.error("feather must be between 0 and 1.5 pixels")
    records = [extract_file(path, args.output_dir / path.name, args) for path in args.inputs]
    preview_directory = args.report.parent / args.report.stem
    preview_paths = make_previews(records, preview_directory, args.grid)
    parameters = {key: str(value) if isinstance(value, Path) else value for key, value in vars(args).items() if key != "inputs"}
    report = {"schemaVersion": 1, "purpose": "Alpha extraction review only; character identity is not approved",
              "method": "border-connected color matte + guarded enclosed holes + bounded edge-color extension",
              "parameters": parameters,
              "implementationSha256": digest(Path(__file__)),
              "runtime": {"python": platform.python_version(), "pillow": pillow_version, "numpy": np.__version__},
              "records": records, "previews": preview_paths,
              "visualReview": {"status": "pending", "characterIdentityApproved": False},
              "limitations": ["Checker removal is heuristic, especially for enclosed gray/white details.",
                              "The outer-hole guard protects central face/clothing; inspect hair loops and gaps on both backgrounds.",
                              "Fixed-color mattes need a key not shared with character details.",
                              "No frame alignment, creative redrawing, packaging, installation, or app-state changes are performed."]}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "report": str(args.report), "outputs": [record["output"] for record in records]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
