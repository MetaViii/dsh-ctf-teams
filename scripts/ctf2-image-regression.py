"""Portable read-only image fallback checks; optional decoders are explicitly skipped."""
import importlib.util
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("image_to_text", ROOT / "assets/ctf/image_to_text.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
try:
    from PIL import Image
except ImportError:
    Image = None


@unittest.skipIf(Image is None, "Pillow unavailable")
class ImageFallbackTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="ctf-image-test-")
        self.addCleanup(self.folder.cleanup)
        self.root = pathlib.Path(self.folder.name)
        self.image = Image.new("RGB", (40, 20), "white")
        self.image.paste((0, 0, 0), (0, 0, 20, 20))
        self.image.save(self.root / "sample.png")

    def test_ascii_preserves_file_and_reports_unverified_candidates(self):
        before = (self.root / "sample.png").read_bytes()
        result = helper.analyze(self.root, "sample.png", "ascii", width=40)
        self.assertIn("@", result["text"])
        self.assertIn(" ", result["text"])
        self.assertIn("Unverified", result["notice"])
        self.assertEqual((self.root / "sample.png").read_bytes(), before)

    def test_pixel_compare_and_workspace_boundary(self):
        self.image.save(self.root / "same.png")
        self.assertTrue(helper.analyze(self.root, "sample.png", "compare", "same.png")["equal"])
        self.image.putpixel((10, 10), (255, 255, 255))
        self.image.save(self.root / "changed.png")
        different = helper.analyze(self.root, "sample.png", "compare", "changed.png")
        self.assertFalse(different["equal"])
        self.assertEqual(different["changed_bbox"], (10, 10, 11, 11))
        with self.assertRaisesRegex(ValueError, "inside"):
            helper.inside(self.root, ROOT / "package.json")

    def test_qr_decode_with_real_optional_decoder(self):
        try:
            import cv2
        except ImportError:
            self.skipTest("OpenCV unavailable")
        if not hasattr(cv2, "QRCodeEncoder_create"):
            self.skipTest("OpenCV QR encoder unavailable")
        data = cv2.QRCodeEncoder_create().encode("CTF2{aA01}")
        data = cv2.copyMakeBorder(data, 4, 4, 4, 4, cv2.BORDER_CONSTANT, value=255)
        data = cv2.resize(data, None, fx=10, fy=10, interpolation=cv2.INTER_NEAREST)
        Image.fromarray(data).save(self.root / "qr.png")
        result = helper.analyze(self.root, "qr.png", "decode")
        self.assertIn("CTF2{aA01}", [item["text"] for item in result["candidates"]])


if __name__ == "__main__":
    unittest.main(verbosity=2)
