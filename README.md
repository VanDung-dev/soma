# Soma

Soma is an anatomy study app with a 3D viewer, lesson editor and lesson player. It runs in the browser and as a Tauri desktop app.

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
| `npm run serve` | Serve the web build at <http://127.0.0.1:4173/home> |
| `npm run desktop:dev` | Tauri development |
| `npm run desktop:build` | Desktop executable and resources in `target/release/` |
| `npm run wasm:build` | Rebuild WASM after Rust/GLSL changes; reload the page |
| `npm run content:build` | Rebuild the independent Rust content-data WASM module |

Development and production builds compile both WASM modules. Desktop production builds use `apps/web/dist-desktop/` for the frontend. Web and desktop development share port 5173, so run one at a time.
Desktop requires [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

### Desktop builds and releases on GitHub Actions

Set `[workspace.package].version` in [Cargo.toml](Cargo.toml) and run `cargo update --workspace` to refresh `Cargo.lock`. Tauri inherits this version. Run `node scripts/release-version.mjs` to print it.

Run **Actions → Build desktop → Run workflow** to build installers. For a tagged build, select the `v<version>` tag that matches `Cargo.toml`. Choose `all` for both platforms, or choose `windows` or `macos` for a single platform. The workflow starts manually.

- `Soma-windows-x64-setup.exe` is the Windows x64 installer. It installs on x64 Windows and on Windows 11 Arm64, where the app runs through x64 emulation.
- `Soma-macos-arm64.dmg` is for Apple Silicon Macs and requires macOS 15 or later. The app is ad-hoc signed; macOS may still require approval in Privacy & Security, and the signature does not provide notarization.

To publish a GitHub Release, select a version tag, choose `all` and enable `create_release`. The workflow attaches both installers and marks `-dev` tags as pre-releases. Leave `create_release` disabled for an artifacts-only build.

### Installer artwork

On macOS, set up the [Python environment](#content-tools) and use these commands to regenerate the DMG PNG and Windows NSIS BMP files from their SVG sources.

```sh
brew install librsvg
.venv/bin/python scripts/render_installer_assets.py
```

### macOS Apple Silicon DMG

Run from the repository root on macOS after setting up the [Python environment](#content-tools).

```sh
.venv/bin/python -m pip install -r scripts/requirements-dmg.txt
rustup target add aarch64-apple-darwin
npm exec --workspace apps/web -- tauri build --bundles app --target aarch64-apple-darwin
version=$(node scripts/release-version.mjs)
mkdir -p target/aarch64-apple-darwin/release/bundle/dmg
.venv/bin/dmgbuild -s scripts/macos-dmg-settings.py \
  -D "app=target/aarch64-apple-darwin/release/bundle/macos/Soma.app" \
  -D "icon=apps/web/src-tauri/icons/icon.icns" \
  -D "background=apps/web/src-tauri/installer-assets/dmg-background.png" \
  Soma "target/aarch64-apple-darwin/release/bundle/dmg/Soma_${version}_aarch64.dmg"
```

The installer appears under `target/aarch64-apple-darwin/release/bundle/dmg/`.

### Windows x64 installer

Both methods use the Node.js and Rust versions listed in [Setup](#setup) and produce `Soma_<version>_x64-setup.exe` under `target/x86_64-pc-windows-msvc/release/bundle/nsis/`. Run the installer on Windows, including in a Windows 11 Arm64 VM with x64 emulation.

#### Build on Windows

Install the [Windows Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#windows) and select the x64 MSVC components in the **Desktop development with C++** workload. Run these commands from the repository root in PowerShell.

```powershell
rustup target add wasm32-unknown-unknown x86_64-pc-windows-msvc
cargo install wasm-pack --version 0.15.1 --locked
npm.cmd ci
npm.cmd exec --workspace apps/web -- tauri build --bundles nsis --target x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw 'Soma build failed' }
```

#### Cross-build on macOS

On an Apple Silicon Mac, install `wasm-pack` as shown in [Setup](#setup) and run these commands from the repository root with Homebrew available.

```sh
brew install llvm lld nsis
export PATH="$(brew --prefix llvm)/bin:$(brew --prefix lld)/bin:$PATH"
rustup target add wasm32-unknown-unknown x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
npm ci
npm exec --workspace apps/web -- tauri build --runner cargo-xwin --bundles nsis --target x86_64-pc-windows-msvc
```

Copy the `*-setup.exe` file to Windows or the VM and run it there.

Desktop builds include the compressed models and source notices in a separate
`models/` resource directory. The packaged app reads those files offline.
For `npm run desktop:build`, keep the generated `models/` directory alongside
the executable when running from `target/release/`.

## Checks

```sh
npm run check
npm test
npm exec --workspace apps/web -- vite build --mode desktop
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

The offline tools in `scripts/models/` and `scripts/wikipedia/` use Python 3.13, as recorded in `.python-version`. From the repository root, create `.venv` with Python's `venv` module, or reuse an existing Python 3.13 environment.

```sh
python -m venv .venv
.venv/bin/python -m unittest discover -s scripts/tests -p 'test_*.py'
```

On Windows, create the environment with `py -3.13 -m venv .venv` and use `.venv\Scripts\python.exe` to run the checks.

The repository includes prebuilt models. To regenerate them, install the npm workspace dependencies from the repository root, install Blender and run:

```sh
npm run models:import
```

The importer uses the repository `.venv` to prepare the source files. Blender runs the export with its bundled Python. Set `BLENDER_BIN` if Blender is installed outside the default location.

## Wikipedia proxy

`npm run dev` and `npm run serve` provide the web proxy. The packaged desktop app includes a local Rust proxy. For static-only web hosting, point the web build to a deployed Wikipedia proxy.

```sh
VITE_WIKIPEDIA_PROXY_URL=https://your-server.example/wikipedia npm run build
```

## Backend direction

Soma runs without a standalone application backend. Use Rust for future server features and agree on the API and data contracts first.

## References

- The anatomy information panel links to related sections of [OpenStax, Anatomy and Physiology 2e](https://openstax.org/details/books/anatomy-and-physiology-2e) (OpenStax, Rice University, 2022) alongside Wikipedia. These English web readings provide context for the selected structure or group; they do not imply that the book covers each model separately. The curated mappings live in `content/openstax-references.json`, ordered from specific topics to system overviews. No book text, images or PDF are bundled.
- [Architecture](ARCHITECTURE.md)
- Educational reference only; Vietnamese terminology and Wikipedia mappings await medical review.
- Original Soma materials are covered by the [Soma Community and Commercial Use License 1.0](LICENSE) as defined there. Third-party models, data and dependencies retain their own terms. See [NOTICE](NOTICE) and the [Z-Anatomy attribution](apps/web/public/models/z-anatomy/ATTRIBUTION.md).
