# Soma

Soma is an anatomy study app for the web and Tauri desktop. It includes a 3D viewer, a lesson editor and a lesson player.

## Setup

Use Node.js `^24.22.1` or `>=26.12.1` and Rust 1.96 or later. Run commands from the repository root.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.15.1 --locked
npm ci
```

For desktop work, install the platform dependencies. [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Run

| Command | Result |
| --- | --- |
| `npm run dev` | Web development at <http://localhost:5173/home> |
| `npm run build` | Web build in `apps/web/dist/` |
| `npm run serve` | Serve the web build at <http://127.0.0.1:4173/home> |
| `npm run desktop:dev` | Tauri development on port 5173 |
| `npm run desktop:build` | Unbundled desktop build in `target/release/` |
| `npm run wasm:build` | Rebuild both WASM modules after Rust or GLSL changes |
| `npm run content:build` | Rebuild the content WASM module |

Web and desktop development share port 5173. Development and production builds compile both WASM modules. Desktop builds use `apps/web/dist-desktop/` for the frontend and package models in `models/`. Keep that directory alongside the unbundled executable.

## Source layout

The web app lives in `apps/web/src/`. Anatomy and Lessons share `catalog/` and `viewer/`. The lesson editor keeps the details form and cover editing in separate components and shares cover rendering with the library. [Module ownership](ARCHITECTURE.md#ownership) · [Lesson editor](ARCHITECTURE.md#lesson-editor)

## Checks

```sh
npm run check
npm run build
npm test

cargo fmt --all --check
npm exec --workspace apps/web -- vite build --mode desktop
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
```

The desktop frontend build prepares assets for the workspace-wide Rust checks. To test just the four libraries in `crates/`, run `cargo test --locked -p core -p content -p renderer -p wasm`. [CI workflow](.github/workflows/checks.yml)

Browser checks use Playwright, Chromium and synthetic camera input.

```sh
BENCHMARK_PLAYWRIGHT_MODULE=/path/to/playwright \
BENCHMARK_BROWSER=/path/to/chromium npm run test:browser
```

## Desktop installers

Set the version in `[workspace.package]`, then run `cargo update --workspace` to refresh `Cargo.lock`. Tauri inherits that version. Use `node scripts/release-version.mjs` to print it. [Workspace manifest](Cargo.toml)

### Desktop builds and releases on GitHub Actions

Run **Actions → Build desktop → Run workflow** and choose `all`, `windows` or `macos`. A selected tag must match `v<version>`. The workflow uploads installer artifacts. To also publish a GitHub Release, select the tag, choose `all` and enable `create_release`. Tags containing `-dev` publish as pre-releases. [Desktop workflow](.github/workflows/desktop-build.yml)

| Artifact | Platform |
| --- | --- |
| `Soma-windows-x64-setup.exe` | Windows x64, including x64 emulation on Windows 11 Arm64 |
| `Soma-macos-arm64.dmg` | Apple Silicon, macOS 15 or later. The ad-hoc-signed app may require approval in Privacy & Security. |

### Windows x64 installer

On Windows, select the x64 MSVC components in the **Desktop development with C++** workload, then run in PowerShell. [Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows)

```powershell
rustup target add x86_64-pc-windows-msvc
npm.cmd exec --workspace apps/web -- tauri build --bundles nsis --target x86_64-pc-windows-msvc
```

For a cross-build on an Apple Silicon Mac, use the same project setup and install the cross-build tools with Homebrew.

```sh
brew install llvm lld nsis
export PATH="$(brew --prefix llvm)/bin:$(brew --prefix lld)/bin:$PATH"
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
npm exec --workspace apps/web -- tauri build --runner cargo-xwin --bundles nsis --target x86_64-pc-windows-msvc
```

Both builds produce `Soma_<version>_x64-setup.exe` under `target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

### macOS Apple Silicon DMG

Build the app and package it with `dmgbuild` using the project Python environment. [Python setup](#content-tools)

```sh
.venv/bin/python -m pip install -r scripts/requirements-dmg.txt
rustup target add aarch64-apple-darwin
npm exec --workspace apps/web -- tauri build --bundles app --target aarch64-apple-darwin
version=$(node scripts/release-version.mjs)
bundle=target/aarch64-apple-darwin/release/bundle
mkdir -p "$bundle/dmg"
.venv/bin/dmgbuild -s scripts/macos-dmg-settings.py \
  -D "app=$bundle/macos/Soma.app" \
  -D "icon=apps/web/src-tauri/icons/icon.icns" \
  -D "background=apps/web/src-tauri/installer-assets/dmg-background.png" \
  Soma "$bundle/dmg/Soma_${version}_aarch64.dmg"
```

### Installer artwork

On macOS, use the project Python environment to regenerate the DMG and NSIS artwork from the checked-in SVGs. [Python setup](#content-tools)

```sh
brew install librsvg
.venv/bin/python scripts/render_installer_assets.py
```

## Content tools

The offline model and Wikipedia tools use Python 3.13. Run their tests from the repository root.

```sh
python -m venv .venv
.venv/bin/python -m unittest discover -s scripts/tests -p 'test_*.py'
```

On Windows, use `.venv\Scripts\python.exe`. Soma ships prebuilt models. To regenerate them, install Blender and run `npm run models:import`. Set `BLENDER_BIN` to override the Blender executable. The importer uses the repository virtual environment for preparation and Blender's bundled Python for export.

## Wikipedia proxy

`npm run dev` and `npm run serve` provide the web proxy. The packaged desktop app has a local Rust proxy. For static hosting, set the deployed proxy URL at build time.

```sh
VITE_WIKIPEDIA_PROXY_URL=https://your-server.example/wikipedia npm run build
```

## Backend direction

Soma runs in its web and desktop hosts. For future server features, use Rust and agree on API and data contracts first.

## References

- Anatomy is for educational reference. The Vietnamese terminology glossary awaits medical review and Wikipedia URL mappings are unverified.
- The Anatomy panel links to Wikipedia and related sections of *Anatomy and Physiology 2e*. [OpenStax textbook](https://openstax.org/details/books/anatomy-and-physiology-2e) · [Section mappings](content/openstax-references.json)
- Original Soma materials use the Soma Community and Commercial Use License 1.0. Third-party assets and dependencies retain their own terms. [License](LICENSE) · [Notice](NOTICE) · [Z-Anatomy attribution](apps/web/public/models/z-anatomy/ATTRIBUTION.md)
