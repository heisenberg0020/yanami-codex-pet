#!/usr/bin/env python3
"""Enlarge native cells on a fixed green canvas without redrawing the character."""
import argparse
from pathlib import Path
from PIL import Image

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, default=Path('assets/upstream/yanami-anna/spritesheet.webp'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    with Image.open(args.base) as opened:
        atlas = opened.convert('RGBA')
    if atlas.size != (1536, 2288):
        parser.error('Expected the native 1536x2288 atlas')
    args.output.mkdir(parents=True, exist_ok=True)
    for name, row in [('idle-original', 0), ('waiting-original', 6), ('running-original', 7), ('identity-six', 0)]:
        sheet = Image.new('RGB', (1536, 1024), '#00ff00')
        for index in range(6):
            column = 0 if name == 'identity-six' else index
            frame = atlas.crop((column*192, row*208, (column+1)*192, (row+1)*208))
            frame = frame.resize((384, 416), Image.Resampling.LANCZOS)
            sheet.paste(frame, ((index % 3)*512+64, (index // 3)*512+48), frame)
        sheet.save(args.output / (name + '.png'))

if __name__ == '__main__':
    main()
