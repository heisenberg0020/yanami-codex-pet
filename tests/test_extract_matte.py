"""Small synthetic checks for matte behavior, never for character identity."""

import argparse
import importlib.util
from pathlib import Path
import unittest

import numpy as np

SPEC = importlib.util.spec_from_file_location("extract_matte", Path(__file__).parents[1] / "tools" / "extract_matte.py")
matte = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(matte)


def options(background="checker"):
    return argparse.Namespace(background=background, max_chroma=14, min_gray=90, tolerance=55,
                              spill_threshold=16,
                              min_hole=6, max_hole=1800, hole_zones="outer", min_component=5, feather=0.45)


def checker(size=64):
    y, x = np.indices((size, size))
    gray = np.where((x // 4 + y // 4) % 2, 128, 200).astype(np.uint8)
    return np.repeat(gray[..., None], 3, axis=2)


class MatteTests(unittest.TestCase):
    def test_closed_white_clothing_is_not_removed(self):
        image = checker()
        image[12:58, 16:48] = [24, 50, 90]
        image[24:46, 22:42] = [255, 255, 255]
        rgba, _ = matte.extract_frame(image, options())
        self.assertEqual(rgba[32, 32, 3], 255)
        self.assertEqual(rgba[0, 0, 3], 0)
        self.assertTrue(np.array_equal(rgba[32, 32, :3], [255, 255, 255]))

    def test_checker_in_outer_loop_is_removed(self):
        image = checker()
        original = image.copy()
        image[2:60, 12:52] = [20, 55, 110]
        image[6:14, 26:38] = original[6:14, 26:38]
        rgba, metrics = matte.extract_frame(image, options())
        self.assertEqual(rgba[9, 30, 3], 0)
        self.assertEqual(len(metrics["removedBackgroundHoles"]), 1)

    def test_fixed_green_matte_preserves_white_and_decontaminates_fringe(self):
        image = np.full((64, 64, 3), [0, 255, 0], dtype=np.uint8)
        image[12:58, 16:48] = [20, 45, 95]
        image[24:46, 22:42] = [255, 255, 255]
        rgba, _ = matte.extract_frame(image, options("#00ff00"))
        self.assertEqual(rgba[32, 32, 3], 255)
        self.assertEqual(rgba[0, 0, 3], 0)
        fringe = (rgba[..., 3] > 0) & (rgba[..., 3] < 255)
        self.assertTrue(fringe.any())
        self.assertLess(int(rgba[..., 1][fringe].max()), 100)


if __name__ == "__main__":
    unittest.main()
