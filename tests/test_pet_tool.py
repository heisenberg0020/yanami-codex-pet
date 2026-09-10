"""Regression tests for geometry, transparency, preservation, and safe installation."""

import argparse
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

SPEC = importlib.util.spec_from_file_location("pet_tool", Path(__file__).parents[1] / "tools" / "pet_tool.py")
pet = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pet)


def atlas_fixture() -> Image.Image:
    image = Image.new("RGBA", pet.SIZE)
    draw = ImageDraw.Draw(image)
    for row, count in enumerate(pet.COUNTS):
        for column in range(count):
            x, y = column * 192, row * 208
            draw.rectangle((x + 50, y + 30, x + 140, y + 198), fill=(40 + row * 12, 70 + column * 12, 190, 255))
    return image


class PetToolTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.base = self.root / "base.png"
        atlas_fixture().save(self.base)

    def tearDown(self):
        self.temporary.cleanup()

    def codes(self, path):
        return {entry["code"] for entry in pet.validate(path)["errors"]}

    def build(self, replacements=None):
        args = argparse.Namespace(base=self.base, output=self.root / "package", replace=replacements or [],
                                  fit="native", id=pet.CANDIDATE_ID, name="八奈见杏菜·精修", description="Test")
        return args.output, pet.build(args)

    def test_host_contract_has_73_valid_cells(self):
        report = pet.validate(self.base)
        self.assertTrue(report["ok"], report["errors"])
        self.assertEqual(report["activeCellsFound"], 73)

    def test_offset_grid_crossing_cell_boundary_fails(self):
        image = atlas_fixture()
        ImageDraw.Draw(image).rectangle((180, 40, 202, 80), fill=(0, 0, 255, 255))
        image.save(self.base)
        self.assertIn("cell_edge_overlap", self.codes(self.base))

    def test_opaque_background_fails_even_with_rgba_mode(self):
        Image.new("RGBA", pet.SIZE, (255, 255, 255, 255)).save(self.base)
        self.assertIn("unreadable_or_invalid_image", self.codes(self.base))

    def test_image_without_alpha_fails(self):
        Image.new("RGB", pet.SIZE, "white").save(self.base)
        self.assertIn("unreadable_or_invalid_image", self.codes(self.base))

    def test_animated_input_and_malformed_manifest_fail_as_reports(self):
        first = atlas_fixture()
        second = first.copy()
        ImageDraw.Draw(second).rectangle((50, 30, 140, 198), fill="red")
        animated = self.root / "animated.webp"
        first.save(animated, "WEBP", save_all=True, append_images=[second], duration=100, lossless=True)
        self.assertIn("unreadable_or_invalid_image", self.codes(animated))
        package = self.root / "malformed"
        package.mkdir()
        (package / "pet.json").write_text("[]")
        self.assertIn("unreadable_or_invalid_image", self.codes(package))

    def test_unexpected_extra_cell_fails(self):
        image = atlas_fixture()
        ImageDraw.Draw(image).rectangle((4 * 192 + 20, 3 * 208 + 20, 4 * 192 + 50, 3 * 208 + 80), fill="blue")
        image.save(self.base)
        self.assertIn("unexpected_cell", self.codes(self.base))

    def test_missing_cell_and_wrong_atlas_dimensions_fail(self):
        image = atlas_fixture()
        image.paste(Image.new("RGBA", pet.CELL), pet.cell_box(8, 5)[:2])
        image.save(self.base)
        self.assertIn("missing_cell", self.codes(self.base))
        image.crop((0, 0, 1535, 2288)).save(self.base)
        self.assertIn("atlas_dimensions", self.codes(self.base))

    def test_nondivisible_grid_and_occupied_spare_grid_cell_fail(self):
        source = self.root / "grid.png"
        Image.new("RGBA", (575, 416)).save(source)
        with self.assertRaisesRegex(ValueError, "divisible"):
            pet.extract_grid(source, "3x2", 6)
        grid = Image.new("RGBA", (576, 416))
        draw = ImageDraw.Draw(grid)
        for i in range(6):
            x, y = i % 3 * 192, i // 3 * 208
            draw.rectangle((x + 40, y + 30, x + 130, y + 190), fill="blue")
        grid.save(source)
        with self.assertRaisesRegex(ValueError, "Extra source-grid"):
            pet.extract_grid(source, "3x2", 5)

    def test_large_motion_is_warning_not_failure(self):
        image = atlas_fixture()
        image.paste(Image.new("RGBA", pet.CELL), pet.cell_box(4, 2)[:2])
        ImageDraw.Draw(image).rectangle((2 * 192 + 50, 4 * 208 + 10, 2 * 192 + 140, 4 * 208 + 140), fill="blue")
        image.save(self.base)
        report = pet.validate(self.base)
        self.assertTrue(report["ok"])
        self.assertIn("baseline_motion", {entry["code"] for entry in report["warnings"]})

    def test_build_row_major_order_and_unchanged_cells_are_preserved(self):
        legacy = atlas_fixture()
        ImageDraw.Draw(legacy).rectangle((6 * 192 + 30, 40, 6 * 192 + 120, 190), fill="red")
        legacy.save(self.base)
        grid = Image.new("RGBA", (576, 416))
        draw = ImageDraw.Draw(grid)
        colors = [(20 + i * 30, 120, 80, 255) for i in range(6)]
        for i, color in enumerate(colors):
            x, y = i % 3 * 192, i // 3 * 208
            draw.rectangle((x + 50, y + 30, x + 140, y + 198), fill=color)
        source = self.root / "idle.png"
        grid.save(source)
        package, report = self.build([("idle", str(source), "3x2")])
        result = pet.load_static(package / "spritesheet.webp")
        self.assertEqual(len(report["build"]["preservedActiveCellsVerified"]), 67)
        self.assertIsNone(result.crop(pet.cell_box(0, 6)).getchannel("A").getbbox())
        for i, color in enumerate(colors):
            self.assertEqual(result.getpixel((i * 192 + 70, 100)), color)
        self.assertEqual(result.crop((0, 208, 1536, 2288)).tobytes(), legacy.crop((0, 208, 1536, 2288)).tobytes())

    def test_install_backs_up_candidate_and_never_touches_original(self):
        package, _ = self.build()
        parent = self.root / "pets"
        original = parent / "yanami-anna"
        original.mkdir(parents=True)
        (original / "keep.txt").write_text("untouched")
        destination = parent / pet.CANDIDATE_ID
        destination.mkdir()
        (destination / "previous.txt").write_text("previous version")
        outcome = pet.install(package, destination)
        self.assertEqual((Path(outcome["backup"]) / "previous.txt").read_text(), "previous version")
        self.assertEqual((original / "keep.txt").read_text(), "untouched")
        self.assertEqual(pet.sha256(destination / "spritesheet.webp"), pet.sha256(package / "spritesheet.webp"))
        with self.assertRaisesRegex(ValueError, "separate candidate"):
            pet.install(package, original)

    def test_failed_install_restores_old_candidate(self):
        package, _ = self.build()
        destination = self.root / "pets" / pet.CANDIDATE_ID
        destination.mkdir(parents=True)
        (destination / "previous.txt").write_text("recover me")
        real_replace = pet.os.replace

        def fail_candidate_activation(source, target):
            if Path(source).parent.name.startswith(".yanami-install-") and Path(source).name == pet.CANDIDATE_ID:
                raise OSError("Simulated activation failure")
            return real_replace(source, target)

        with patch.object(pet.os, "replace", side_effect=fail_candidate_activation):
            with self.assertRaisesRegex(OSError, "Simulated"):
                pet.install(package, destination)
        self.assertEqual((destination / "previous.txt").read_text(), "recover me")


if __name__ == "__main__":
    unittest.main()
