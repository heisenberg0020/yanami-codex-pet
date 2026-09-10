#!/usr/bin/env python3
"""Undo fixed reference-sheet packing with one shared scale and translation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import statistics

import numpy as np
from PIL import Image

from extract_matte import digest, make_previews


def bbox(image: Image.Image, threshold: int) -> list[int] | None:
    alpha = np.array(image.getchannel("A"))
    result = Image.fromarray((alpha > threshold).astype(np.uint8) * 255).getbbox()
    return list(result) if result else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--grid", default="3x2")
    parser.add_argument("--crop", nargs=4, type=int, default=[64, 48, 384, 416], metavar=("X", "Y", "WIDTH", "HEIGHT"))
    parser.add_argument("--scale", type=float, default=0.5)
    parser.add_argument("--baseline", type=int, default=203, help="Exclusive lower bbox edge at meaningful alpha")
    parser.add_argument("--alpha-threshold", type=int, default=8)
    args = parser.parse_args()
    columns, rows = (int(item) for item in args.grid.lower().split("x"))
    cx, cy, cw, ch = args.crop
    if (round(cw * args.scale), round(ch * args.scale)) != (192, 208):
        parser.error("The fixed crop and shared scale must produce native 192x208 cells")
    sets = []
    baseline_samples = []
    for path in args.inputs:
        with Image.open(path) as opened:
            if "A" not in opened.getbands():
                raise ValueError(f"Input needs real alpha: {path}")
            source = opened.convert("RGBA")
        if source.width % columns or source.height % rows:
            raise ValueError("Input cannot be divided into the requested grid")
        width, height = source.width // columns, source.height // rows
        if min(cx, cy) < 0 or cx + cw > width or cy + ch > height:
            raise ValueError("Fixed crop exceeds source cell")
        frames, entries = [], []
        for index in range(columns * rows):
            x, y = index % columns * width, index // columns * height
            frame = source.crop((x, y, x + width, y + height))
            before = bbox(frame, args.alpha_threshold)
            if not before or before[0] < cx or before[1] < cy or before[2] > cx + cw or before[3] > cy + ch:
                raise ValueError(f"Fixed crop would cut visible artwork: {path.name}, frame {index}, {before}")
            native = frame.crop((cx, cy, cx + cw, cy + ch)).resize((192, 208), Image.Resampling.LANCZOS)
            scaled = bbox(native, args.alpha_threshold)
            baseline_samples.append(scaled[3])
            frames.append(native)
            entries.append({"index": index, "sourceBBox": bbox(frame, 0), "sourceMeaningfulBBox": before,
                            "scaledBBox": bbox(native, 0), "scaledMeaningfulBBox": scaled})
        sets.append((path, frames, entries))
    # One translation for every frame in every input: no per-character scaling
    # and no per-frame foot pinning that would erase intentional motion.
    shift_y = round(args.baseline - statistics.median(baseline_samples))
    records = []
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for path, frames, entries in sets:
        sheet = Image.new("RGBA", (192 * columns, 208 * rows))
        for index, (frame, entry) in enumerate(zip(frames, entries)):
            moved = Image.new("RGBA", (192, 208))
            moved.paste(frame, (0, shift_y))
            before_alpha = np.array(frame.getchannel("A"))
            moved_alpha = np.array(moved.getchannel("A"))
            if int((before_alpha > args.alpha_threshold).sum()) != int((moved_alpha > args.alpha_threshold).sum()):
                raise ValueError(f"Shared translation would cut visible artwork: {path.name}, frame {index}")
            entry.update({"translation": [0, shift_y], "outputBBox": bbox(moved, 0),
                          "outputMeaningfulBBox": bbox(moved, args.alpha_threshold)})
            sheet.paste(moved, (index % columns * 192, index // columns * 208))
        output = args.output_dir / path.name
        sheet.save(output, "PNG", optimize=True)
        records.append({"input": str(path), "inputSha256": digest(path), "output": str(output),
                        "outputSha256": digest(output), "size": list(sheet.size), "mode": "RGBA", "frames": entries})
    report = {"schemaVersion": 1, "implementationSha256": digest(Path(__file__)),
              "parameters": {"grid": args.grid, "crop": args.crop, "scale": args.scale,
                             "baselineTargetExclusive": args.baseline, "alphaThreshold": args.alpha_threshold},
              "sharedTranslation": [0, shift_y], "baselineSamplesBeforeTranslation": baseline_samples,
              "perFrameScaling": False, "perFrameTranslation": False, "records": records,
              "previews": make_previews(records, args.report.parent / args.report.stem, args.grid),
              "visualReview": {"status": "pending"},
              "notes": ["Fixed inverse of reference packing, followed by one shared translation.",
                        "Full alpha bbox and meaningful alpha bbox are both retained; do not infer anatomy from bbox alone."]}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "report": str(args.report), "sharedTranslation": report["sharedTranslation"],
                      "outputs": [record["output"] for record in records]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
