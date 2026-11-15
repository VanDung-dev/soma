from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "apps/web/src-tauri/installer-assets"


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

    print("Updated DMG PNG and NSIS BMP installer assets.")


if __name__ == "__main__":
    main()
