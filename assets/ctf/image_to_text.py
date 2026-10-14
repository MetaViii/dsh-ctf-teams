#!/usr/bin/env python3
"""Read-only vision fallback. Decodes are candidates, never platform verdicts."""
import argparse
import json
import pathlib
import sys


def inside(workspace, value):
    root = pathlib.Path(workspace).resolve(strict=True)
    path = (root / value).resolve(strict=True)
    if not path.is_relative_to(root):
        raise ValueError("image must resolve inside the challenge workspace")
    return path


def analyze(workspace, image, action="ascii", compare=None, width=80):
    from PIL import Image, ImageChops, ImageStat
    path = inside(workspace, image)
    with Image.open(path) as source:
        if source.width * source.height > 25_000_000:
            raise ValueError("image exceeds 25 million pixels; create a smaller analysis copy first")
        source.load()
        result = {"action": action, "size": list(source.size), "mode": source.mode,
                  "notice": "Unverified extraction. Keep ambiguous O/0, I/l/1, a-d/A-D as candidates; the platform decides."}
        if action == "ascii":
            width = max(8, min(width, 160))
            height = max(1, min(240, round(source.height / source.width * width * 0.45)))
            small = source.convert("L").resize((width, height))
            pixels = list(small.getdata())
            palette = "@%#*+=-:. "
            result["text"] = "\n".join("".join(palette[pixels[y * width + x] * 9 // 255] for x in range(width)) for y in range(height))
        elif action == "ocr":
            import pytesseract
            data = pytesseract.image_to_data(source, output_type=pytesseract.Output.DICT, timeout=20)
            result["candidates"] = [{"text": text, "confidence": data["conf"][i]} for i, text in enumerate(data["text"]) if text.strip()][:500]
        elif action == "decode":
            candidates = []
            missing = []
            try:
                import cv2
                matrix = cv2.imread(str(path))
                text, _, _ = cv2.QRCodeDetector().detectAndDecode(matrix)
                if text:
                    candidates.append({"text": text, "kind": "QR", "decoder": "OpenCV"})
            except (ImportError, RuntimeError):
                missing.append("opencv-python")
            try:
                from pyzbar.pyzbar import decode
                for item in decode(source):
                    candidates.append({"text": item.data.decode("utf-8", errors="replace"), "bytes_hex": item.data.hex(), "kind": item.type, "decoder": "pyzbar"})
            except (ImportError, OSError):
                missing.append("pyzbar + system zbar")
            result.update(candidates=candidates, optional_dependencies_missing=missing)
            if not candidates and len(missing) == 2:
                raise ValueError("decode needs opencv-python or pyzbar + system zbar; no decoder available")
        elif action == "compare":
            if not compare:
                raise ValueError("compare requires a second workspace image")
            with Image.open(inside(workspace, compare)) as other:
                if source.size != other.size:
                    raise ValueError("pixel comparison requires equal dimensions")
                difference = ImageChops.difference(source.convert("RGB"), other.convert("RGB"))
                result.update(equal=difference.getbbox() is None, changed_bbox=difference.getbbox(), mean_absolute_channel_difference=ImageStat.Stat(difference).mean)
        else:
            raise ValueError("unknown action")
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--action", choices=["ascii", "ocr", "decode", "compare"], default="ascii")
    parser.add_argument("--compare")
    parser.add_argument("--width", type=int, default=80)
    args = parser.parse_args()
    try:
        print(json.dumps(analyze(args.workspace, args.image, args.action, args.compare, args.width), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"error": str(error), "hint": "ASCII/compare require Pillow; OCR also needs pytesseract + Tesseract. Install only needed dependencies in your solve environment."}))
        sys.exit(1)
