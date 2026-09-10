"""Registration checks for the fixed source packing inverse."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageDraw

SCRIPT = Path(__file__).parents[1] / "tools" / "align_frames.py"


class AlignmentTests(unittest.TestCase):
    def make_source(self, path, outside=False):
        sheet = Image.new("RGBA", (1536, 1024))
        for index in range(6):
            native = Image.new("RGBA", (192, 208))
            ImageDraw.Draw(native).rectangle((48, 5 + index, 143, 202), fill=(30 + index * 20, 80, 150, 255))
            frame = Image.new("RGBA", (512, 512))
            frame.paste(native.resize((384, 416), Image.Resampling.NEAREST), (64, 48))
            if outside and index == 0:
                ImageDraw.Draw(frame).rectangle((20, 100, 30, 110), fill="red")
            sheet.paste(frame, (index % 3 * 512, index // 3 * 512))
        sheet.save(path)

    def test_native_dimensions_order_and_one_shared_translation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, output, report = root / "row.png", root / "native", root / "review.json"
            self.make_source(source)
            result = subprocess.run([sys.executable, str(SCRIPT), str(source), "--output-dir", str(output),
                                     "--report", str(report)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            metadata = json.loads(report.read_text())
            image = Image.open(output / source.name)
            self.assertEqual(image.size, (576, 416))
            self.assertEqual(metadata["parameters"]["scale"], 0.5)
            self.assertFalse(metadata["perFrameScaling"])
            for index, entry in enumerate(metadata["records"][0]["frames"]):
                self.assertEqual(entry["translation"], metadata["sharedTranslation"])
                x, y = index % 3 * 192 + 80, index // 3 * 208 + 100
                self.assertEqual(image.getpixel((x, y)), (30 + index * 20, 80, 150, 255))

    def test_fixed_crop_rejects_visible_art_outside_bounds(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "row.png"
            self.make_source(source, outside=True)
            result = subprocess.run([sys.executable, str(SCRIPT), str(source), "--output-dir", str(root / "native"),
                                     "--report", str(root / "review.json")], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("would cut visible artwork", result.stderr)


if __name__ == "__main__":
    unittest.main()
