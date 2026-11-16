# Soma

Anatomy viewer: React, Rust/WASM and Tauri.

## Setup

Node.js 24.22.1+ (24.x) or 26.12.1+, Rust 1.96+ and Cargo.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
npm install
```

## Run

| Command | Result |
| --- | --- |
| `npm run dev` | Web: <http://localhost:5173/home> |
| `npm run build` | Web output: `apps/web/dist/` |
| `npm run serve` | Preview: <http://127.0.0.1:4173/home> |
| `npm run desktop:dev` | Tauri development |
| `npm run desktop:build` | Desktop output: `target/release/`; unsigned, no installer |
| `npm run wasm:build` | Rebuild WASM after Rust/GLSL changes; reload the page |
| `npm run content:build` | Rebuild the independent Rust content-data WASM module |

WASM builds before dev/build. Web and desktop dev share port 5173; run one at a time.
Desktop requires [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

### Desktop builds and releases on GitHub Actions

Run **Actions → Build desktop → Run workflow** to build installers. Select the version tag as the ref (for example, `v0.1.0-dev1`) and choose `all` to build both platforms. Creating a tag alone does not start a build.

- `Soma-windows-x64-setup.exe` is the Windows x64 installer. It installs on x64 Windows and on Windows 11 Arm64, where the app runs through x64 emulation.
- `Soma-macos-arm64.dmg` is for Apple Silicon Macs and requires macOS 15 or later.

To create a GitHub Release, enable `create_release` in the same workflow run. This rebuilds both installers and attaches them to the release. Tags containing `-dev` are published as pre-releases.

To build artifacts without publishing, leave `create_release` disabled. For a single platform, select `windows` or `macos`.

### Installer artwork

On macOS, regenerate the DMG PNG and Windows NSIS BMP files from their SVG sources with:

```sh
brew install librsvg
.venv/bin/python scripts/render_installer_assets.py
```

### macOS Apple Silicon DMG

Run from the repository root on macOS.

```sh
rustup target add aarch64-apple-darwin
npm exec --workspace apps/web -- tauri build --bundles app --target aarch64-apple-darwin
version=$(node -p "require('./apps/web/src-tauri/tauri.conf.json').version")
mkdir -p target/aarch64-apple-darwin/release/bundle/dmg
dmgbuild -s scripts/macos-dmg-settings.py \
  -D "app=target/aarch64-apple-darwin/release/bundle/macos/Soma.app" \
  -D "icon=apps/web/src-tauri/icons/icon.icns" \
  -D "background=apps/web/src-tauri/installer-assets/dmg-background.png" \
  Soma "target/aarch64-apple-darwin/release/bundle/dmg/Soma_${version}_aarch64.dmg"
```

Install the pinned DMG tool into the repository virtual environment with
`.venv/bin/python -m pip install -r scripts/requirements-dmg.txt` first. The
installer appears under `target/aarch64-apple-darwin/release/bundle/dmg/`.

### Windows x64 installer

Run in PowerShell from the repository root on Windows with the x64 MSVC Rust toolchain and the [Windows Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#windows).

```powershell
npm.cmd exec --workspace apps/web -- tauri build --bundles nsis --target x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw 'Soma build failed' }
```

Run the setup executable under `target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

Desktop builds include the compressed models and source notices in a separate
`models/` resource directory. The packaged app reads those files offline.
For `npm run desktop:build`, keep the generated `models/` directory alongside
the executable when running from `target/release/`.

## Checks

```sh
npm run check
npm test
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all --check
```

Browser checks use an existing Playwright installation, Chromium and synthetic camera input:

```sh
BENCHMARK_PLAYWRIGHT_MODULE=/path/to/playwright \
BENCHMARK_BROWSER=/path/to/chromium npm run test:browser
```

## Content tools

Python 3.13, UV and repository `.venv`; model export also requires Blender.
Models are included; regenerate only when needed. Offline tools live in
`scripts/models/` and `scripts/wikipedia/`, with Python tests in `scripts/tests/`.
Node tooling has its own workspace manifest in `scripts/package.json`;
install workspace dependencies with `npm install` from the repository root.

```sh
uv sync
uv run python -m unittest discover -s scripts/tests -p 'test_*.py'
npm run models:import
```

Blender exports use its bundled Python.

## Wikipedia proxy

`npm run serve` includes the proxy. Static hosting and packaged desktop need a deployed proxy:

```sh
VITE_WIKIPEDIA_PROXY_URL=https://your-server.example/wikipedia npm run build
```

## Backend direction

No backend. Future server work: Rust, with API/data contracts agreed first.

## References

- The anatomy information panel links to related sections of [OpenStax, Anatomy and Physiology 2e](https://openstax.org/details/books/anatomy-and-physiology-2e) (OpenStax, Rice University, 2022) alongside Wikipedia. These English web readings provide context for the selected structure or group; they do not imply that the book covers each model separately. The curated mappings live in `content/openstax-references.json`, ordered from specific topics to system overviews. No book text, images or PDF are bundled.
- [Architecture](ARCHITECTURE.md)
- Educational reference only; Vietnamese terminology and Wikipedia mappings await medical review.
- Code: [Apache-2.0](LICENSE). Model/data terms: [NOTICE](NOTICE), [attribution](apps/web/public/models/z-anatomy/ATTRIBUTION.md).
