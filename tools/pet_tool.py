#!/usr/bin/env python3
"""Mechanical packing, validation and candidate installation for Codex v2 pets."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageChops

CELL = (192, 208)
SIZE = (1536, 2288)
CANDIDATE_ID = "yanami-anna-refined"
STATES = {
    "idle": {"row": 0, "durations_ms": [1680, 660, 660, 840, 840, 1920]},
    "running-right": {"row": 1, "durations_ms": [120] * 7 + [220]},
    "running-left": {"row": 2, "durations_ms": [120] * 7 + [220]},
    "waving": {"row": 3, "durations_ms": [140] * 3 + [280]},
    "jumping": {"row": 4, "durations_ms": [140] * 4 + [280]},
    "failed": {"row": 5, "durations_ms": [140] * 7 + [240]},
    "waiting": {"row": 6, "durations_ms": [150] * 5 + [260]},
    "running": {"row": 7, "durations_ms": [120] * 5 + [220]},
    "review": {"row": 8, "durations_ms": [150] * 5 + [280]},
}
COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def cell_box(row: int, column: int) -> tuple[int, int, int, int]:
    return (column * CELL[0], row * CELL[1], (column + 1) * CELL[0], (row + 1) * CELL[1])


def issue(code: str, message: str, **context: object) -> dict:
    return {"code": code, "message": message, **context}


def load_static(path: Path) -> Image.Image:
    with Image.open(path) as image:
        if getattr(image, "n_frames", 1) != 1:
            raise ValueError(f"Animated images are outside this release: {path}")
        if image.format not in {"PNG", "WEBP"}:
            raise ValueError(f"Expected PNG or WebP: {path}")
        if "A" not in image.getbands() and "transparency" not in image.info:
            raise ValueError(f"Image has no transparency channel: {path}")
        result = image.convert("RGBA")
    if result.getchannel("A").getextrema()[0] == 255:
        raise ValueError(f"Image has no transparent background pixels: {path}")
    return result


def resolve_atlas(path: Path) -> tuple[Path, dict | None]:
    if not path.is_dir():
        return path, None
    manifest = json.loads((path / "pet.json").read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("pet.json must contain a JSON object")
    if manifest.get("spriteVersionNumber") != 2:
        raise ValueError("pet.json must declare spriteVersionNumber: 2")
    if not isinstance(manifest.get("displayName"), str) or not manifest["displayName"].strip():
        raise ValueError("pet.json needs a nonempty displayName")
    sprite = manifest.get("spritesheetPath")
    if not isinstance(sprite, str) or not sprite or Path(sprite).name != sprite:
        raise ValueError("spritesheetPath must be a local file name, without directories")
    atlas = path / sprite
    if atlas.is_symlink():
        raise ValueError("A packaged spritesheet cannot be a symbolic link")
    return atlas, manifest


def validate(path: Path) -> dict:
    report = {"schemaVersion": 1, "ok": False, "errors": [], "warnings": [], "cells": []}
    errors, warnings = report["errors"], report["warnings"]
    try:
        atlas_path, manifest = resolve_atlas(path)
        image = load_static(atlas_path)
        report.update({"atlas": str(atlas_path), "sha256": sha256(atlas_path),
                       "size": list(image.size), "mode": image.mode, "expectedActiveCells": 73,
                       "expectedTransparentCells": 15, "spriteVersionNumber": 2})
        if manifest is not None:
            report["manifest"] = manifest
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        errors.append(issue("unreadable_or_invalid_image", str(exc)))
        return report
    if image.size != SIZE:
        errors.append(issue("atlas_dimensions", f"Expected {SIZE}, got {image.size}"))
        return report
    for row, count in enumerate(COUNTS):
        row_metrics = []
        for column in range(8):
            alpha = image.crop(cell_box(row, column)).getchannel("A")
            bbox = alpha.getbbox()
            if column >= count:
                if bbox is not None:
                    errors.append(issue("unexpected_cell", "Host-unused cell must be fully transparent",
                                        row=row, column=column, bbox=list(bbox)))
                continue
            if bbox is None:
                errors.append(issue("missing_cell", "Required cell is empty", row=row, column=column))
                continue
            occupied = sum(1 for pixel in alpha.getdata() if pixel > 8)
            metric = {"row": row, "column": column, "bbox": list(bbox),
                      "baseline": bbox[3], "visiblePixels": occupied}
            row_metrics.append(metric)
            report["cells"].append(metric)
            # A meaningful alpha value at the cell edge signals clipping or grid leakage.
            edges = [alpha.crop((0, 0, 192, 1)), alpha.crop((0, 207, 192, 208)),
                     alpha.crop((0, 0, 1, 208)), alpha.crop((191, 0, 192, 208))]
            if any(edge.getextrema()[1] > 8 for edge in edges):
                errors.append(issue("cell_edge_overlap", "Visible content touches a cell edge; inspect cropping/alignment",
                                    row=row, column=column, bbox=list(bbox)))
            if occupied < 100:
                warnings.append(issue("small_visible_area", "Cell is unusually sparse", row=row, column=column))
        if row_metrics:
            baselines = [entry["baseline"] for entry in row_metrics]
            areas = [entry["visiblePixels"] for entry in row_metrics]
            if max(baselines) - min(baselines) > 16:
                warnings.append(issue("baseline_motion", "Baseline varies; motion may be intentional",
                                      row=row, span=max(baselines) - min(baselines)))
            if min(areas) and max(areas) / min(areas) > 1.8:
                warnings.append(issue("silhouette_area_change", "Silhouette area changes substantially; inspect motion",
                                      row=row, ratio=round(max(areas) / min(areas), 3)))
            if row < 9:
                first = image.crop(cell_box(row, 0)).getchannel("A")
                last = image.crop(cell_box(row, count - 1)).getchannel("A")
                changed = sum(1 for pixel in ImageChops.difference(first, last).getdata() if pixel > 32)
                ratio = changed / max(max(areas), 1)
                if ratio > 0.5:
                    warnings.append(issue("loop_endpoint_difference", "First/last silhouettes differ; review the loop visually",
                                          row=row, changedAreaRatio=round(ratio, 3)))
    report["activeCellsFound"] = len(report["cells"])
    report["ok"] = not errors
    return report


def row_number(value: str) -> int:
    row = STATES[value]["row"] if value in STATES else int(value)
    if not 0 <= row < 11:
        raise ValueError("Replacement row must be 0–10 or a native state name")
    return row


def extract_grid(path: Path, grid: str, expected: int, fit: str = "contain") -> list[Image.Image]:
    image = load_static(path)
    try:
        columns, rows = (int(value) for value in grid.lower().split("x"))
    except (ValueError, TypeError) as exc:
        raise ValueError("Grid must look like 3x2 or 8x1") from exc
    if columns <= 0 or rows <= 0 or columns * rows < expected:
        raise ValueError(f"Grid needs at least {expected} cells")
    if image.width % columns or image.height % rows:
        raise ValueError("Source size is not exactly divisible by the declared grid")
    width, height = image.width // columns, image.height // rows
    if fit == "native" and (width, height) != CELL:
        raise ValueError(f"Native source cells must be {CELL}, got {(width, height)}")
    frames = []
    for index in range(columns * rows):
        x, y = (index % columns) * width, (index // columns) * height
        frame = image.crop((x, y, x + width, y + height))
        bbox = frame.getchannel("A").getbbox()
        if index >= expected:
            if bbox is not None:
                raise ValueError(f"Extra source-grid cell {index} contains visible content")
            continue
        if bbox is None:
            raise ValueError(f"Source-grid cell {index} is empty")
        if fit == "contain" and frame.size != CELL:
            scale = min(CELL[0] / width, CELL[1] / height)
            size = (max(1, round(width * scale)), max(1, round(height * scale)))
            resized = frame.resize(size, Image.Resampling.LANCZOS)
            frame = Image.new("RGBA", CELL)
            frame.paste(resized, ((CELL[0] - size[0]) // 2, (CELL[1] - size[1]) // 2))
        frames.append(frame)
    return frames


def dump_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build(args: argparse.Namespace) -> dict:
    if args.base.resolve() == (args.output / "spritesheet.webp").resolve():
        raise ValueError("Output must not overwrite the supplied base atlas")
    source = load_static(args.base)
    if source.size != SIZE:
        raise ValueError(f"Base atlas must be {SIZE}")
    atlas = source.copy()
    # Legacy Yanami has a seventh nonempty idle cell; this host loops only columns 0–5.
    cleared = []
    if atlas.crop(cell_box(0, 6)).getchannel("A").getbbox() is not None:
        cleared.append({"row": 0, "column": 6})
    atlas.paste(Image.new("RGBA", CELL), cell_box(0, 6)[:2])
    replacements, seen = [], set()
    for row_value, filename, grid in args.replace:
        row = row_number(row_value)
        if row in seen:
            raise ValueError(f"Row {row} was supplied twice")
        seen.add(row)
        path = Path(filename)
        frames = extract_grid(path, grid, COUNTS[row], args.fit)
        for column, frame in enumerate(frames):
            atlas.paste(frame, cell_box(row, column)[:2])
        replacements.append({"row": row, "source": str(path), "sha256": sha256(path),
                             "grid": grid, "fit": args.fit, "frames": len(frames)})
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".build-", dir=args.output.parent) as staging_dir:
        staging = Path(staging_dir)
        sprite = staging / "spritesheet.webp"
        atlas.save(sprite, "WEBP", lossless=True, exact=True, method=6)
        manifest = {"id": args.id, "displayName": args.name, "description": args.description,
                    "spriteVersionNumber": 2, "spritesheetPath": "spritesheet.webp"}
        dump_json(staging / "pet.json", manifest)
        report = validate(staging)
        decoded = load_static(sprite)
        preserved = []
        for row, count in enumerate(COUNTS):
            if row not in seen:
                for column in range(count):
                    if source.crop(cell_box(row, column)).tobytes() != decoded.crop(cell_box(row, column)).tobytes():
                        raise ValueError(f"Unreplaced cell changed during export: row {row}, column {column}")
                    preserved.append([row, column])
        report["atlas"] = str(args.output / "spritesheet.webp")
        report["build"] = {"base": str(args.base), "baseSha256": sha256(args.base),
                           "replacements": replacements, "clearedUnusedCells": cleared,
                           "preservedActiveCellsVerified": preserved, "encoding": "static-lossless-WebP"}
        dump_json(args.output / "validation.json", report)
        if not report["ok"]:
            raise ValueError(f"Candidate failed validation; see {args.output / 'validation.json'}")
        for name in ("pet.json", "spritesheet.webp"):
            os.replace(staging / name, args.output / name)
    return report


def install(package: Path, destination: Path) -> dict:
    if destination.name != CANDIDATE_ID:
        raise ValueError(f"Installer only writes the separate candidate folder {CANDIDATE_ID}")
    if destination.is_symlink():
        raise ValueError("Install destination cannot be a symbolic link")
    report = validate(package)
    if not report["ok"]:
        raise ValueError(f"Package did not pass validation: {report['errors']}")
    atlas, manifest = resolve_atlas(package)
    if manifest is None or manifest.get("id") != CANDIDATE_ID:
        raise ValueError(f"Installer requires a package with id {CANDIDATE_ID}")
    files = {"pet.json": package / "pet.json", atlas.name: atlas}
    expected = {name: sha256(path) for name, path in files.items()}
    destination.parent.mkdir(parents=True, exist_ok=True)
    backup = None
    with tempfile.TemporaryDirectory(prefix=".yanami-install-", dir=destination.parent) as temporary:
        staged = Path(temporary) / CANDIDATE_ID
        staged.mkdir()
        for name, path in files.items():
            shutil.copy2(path, staged / name)
            if sha256(staged / name) != expected[name]:
                raise ValueError(f"Staged hash mismatch: {name}")
        if not validate(staged)["ok"]:
            raise ValueError("Staged package failed validation")
        if destination.exists():
            if not destination.is_dir():
                raise ValueError("Existing install destination is not a directory")
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            backup = destination.parent / ".backups" / f"{CANDIDATE_ID}-{stamp}-{uuid.uuid4().hex[:8]}"
            backup.parent.mkdir(parents=True, exist_ok=True)
            os.replace(destination, backup)
        try:
            os.replace(staged, destination)
            actual = {name: sha256(destination / name) for name in files}
            if actual != expected:
                raise ValueError("Installed hash verification failed")
        except BaseException:
            if destination.exists():
                failed = Path(temporary) / "failed-install"
                os.replace(destination, failed)
            if backup is not None:
                os.replace(backup, destination)
            raise
    return {"ok": True, "destination": str(destination), "backup": str(backup) if backup else None,
            "sha256": expected, "selectionChanged": False}


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    pack = commands.add_parser("build", help="Replace selected rows and export a static v2 package")
    pack.add_argument("--base", required=True, type=Path)
    pack.add_argument("--output", required=True, type=Path)
    pack.add_argument("--replace", nargs=3, action="append", default=[], metavar=("ROW", "PNG", "GRID"))
    pack.add_argument("--fit", choices=("contain", "native"), default="contain")
    pack.add_argument("--id", default=CANDIDATE_ID)
    pack.add_argument("--name", default="八奈见杏菜·精修")
    pack.add_argument("--description", default="Yanami Anna, a refined companion for Codex.")
    check = commands.add_parser("validate", help="Validate a package directory or static atlas")
    check.add_argument("path", type=Path)
    check.add_argument("--json", type=Path)
    setup = commands.add_parser("install", help="Install the separate candidate with backup and hash verification")
    setup.add_argument("package", type=Path)
    setup.add_argument("--destination", type=Path,
                       default=Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "pets" / CANDIDATE_ID)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "build":
            report = build(args)
            print(json.dumps({"ok": True, "package": str(args.output),
                              "validation": str(args.output / "validation.json"),
                              "warningCount": len(report["warnings"])}, ensure_ascii=False))
        elif args.command == "validate":
            report = validate(args.path)
            if args.json:
                dump_json(args.json, report)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0 if report["ok"] else 1
        else:
            print(json.dumps(install(args.package, args.destination.expanduser()), ensure_ascii=False, indent=2))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
