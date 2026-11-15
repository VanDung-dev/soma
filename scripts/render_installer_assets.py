from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "apps/web/src-tauri/installer-assets"


def make_bmp_bottom_up(path):
    bitmap = bytearray(path.read_bytes())
    if bitmap[:2] != b"BM" or len(bitmap) < 54:
        raise SystemExit(f"Not a Windows BMP: {path}")

    header_size = struct.unpack_from("<I", bitmap, 14)[0]
    width, height = struct.unpack_from("<ii", bitmap, 18)
    bits_per_pixel = struct.unpack_from("<H", bitmap, 28)[0]
    compression = struct.unpack_from("<I", bitmap, 30)[0]
    if header_size < 40 or width <= 0 or height == 0 or bits_per_pixel != 24 or compression != 0:
        raise SystemExit(f"Expected an uncompressed 24-bit BMP: {path}")
    if height > 0:
        return

    pixel_offset = struct.unpack_from("<I", bitmap, 10)[0]
    row_size = (width * 3 + 3) & ~3
    pixel_end = pixel_offset + row_size * -height
    if pixel_end > len(bitmap):
        raise SystemExit(f"BMP pixel data is incomplete: {path}")

    pixels = bitmap[pixel_offset:pixel_end]
    bitmap[pixel_offset:pixel_end] = b"".join(
        pixels[offset:offset + row_size]
        for offset in range(len(pixels) - row_size, -1, -row_size)
    )
    struct.pack_into("<i", bitmap, 22, -height)
    path.write_bytes(bitmap)


def main():
    if sys.platform != "darwin":
        raise SystemExit("Installer asset conversion requires macOS (sips).")

    rsvg_convert = shutil.which("rsvg-convert")
    sips = shutil.which("sips")
    if not rsvg_convert:
        raise SystemExit("rsvg-convert not found. Install it with: brew install librsvg")
    if not sips:
        raise SystemExit("sips not found; it should be included with macOS.")

    subprocess.run(
        [
            rsvg_convert,
            "-w",
            "660",
            "-h",
            "400",
            str(ASSETS / "dmg-background.svg"),
            "-o",
            str(ASSETS / "dmg-background.png"),
        ],
        check=True,
    )

    with tempfile.TemporaryDirectory(prefix="soma-installer-assets-") as temp_dir:
        for name, width, height in (("nsis-header", 150, 57), ("nsis-sidebar", 164, 314)):
            png = Path(temp_dir) / f"{name}.png"
            subprocess.run(
                [
                    rsvg_convert,
                    "-w",
                    str(width),
                    "-h",
                    str(height),
                    str(ASSETS / f"{name}.svg"),
                    "-o",
                    str(png),
                ],
                check=True,
            )
            subprocess.run(
                [sips, "-s", "format", "bmp", "--out", str(ASSETS / f"{name}.bmp"), str(png)],
                check=True,
            )
            make_bmp_bottom_up(ASSETS / f"{name}.bmp")

    print("Updated DMG PNG and NSIS BMP installer assets.")


if __name__ == "__main__":
    main()
