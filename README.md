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

### Manual desktop build on GitHub Actions

Once the workflow is on the default branch, open **Actions → Build desktop → Run workflow** and select `all` to build both packages. Download the ZIP files from **Artifacts** on the completed run.

- `Soma-windows.zip` contains an x64 installer. The app runs natively on x64 and under emulation on Windows 11 Arm64.
- `Soma-macos.zip` contains a universal app that runs natively on Intel and Apple Silicon.

With GitHub CLI, request both builds from the repository root.

```sh
gh workflow run desktop-build.yml -f platform=all
```

For a single package, use `windows` or `macos`. The workflow runs only on manual request.

### macOS universal app and ZIP

Run from the repository root on macOS.

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm exec --workspace apps/web -- tauri build \
  --bundles app --target universal-apple-darwin &&
ditto -c -k --sequesterRsrc --keepParent \
  target/universal-apple-darwin/release/bundle/macos/Soma.app \
  target/Soma-macos.zip
```

Extract `target/Soma-macos.zip` and open `Soma.app` in Finder.

### Windows x64 installer and ZIP

Run in PowerShell from the repository root on Windows with the x64 MSVC Rust toolchain and the [Windows Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#windows).

```powershell
npm.cmd exec --workspace apps/web -- tauri build --bundles nsis --target x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw 'Soma build failed' }

$version = (Get-Content apps/web/src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
$installer = "target/x86_64-pc-windows-msvc/release/bundle/nsis/Soma_${version}_x64-setup.exe"
Compress-Archive -LiteralPath $installer -DestinationPath target/Soma-Windows-x64.zip -Force
```

Extract `target/Soma-Windows-x64.zip` and run the setup executable.

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
