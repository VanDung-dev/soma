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

- `Soma-windows.zip` contains an x64 installer for x64 Windows.
- `Soma-macos-arm64.zip` contains an Apple Silicon app and requires macOS 15 or later.

Intel Mac and Windows ARM packages are not provided.

With GitHub CLI, request both builds from the repository root.

```sh
gh workflow run desktop-build.yml -f platform=all
```

For a single package, use `windows` or `macos`. The workflow runs only on manual request.

### macOS ARM app and ZIP

Run from the repository root on macOS.
The `CARGO_PROFILE_RELEASE_STRIP=none` setting avoids a macOS linker issue that
breaks release proc-macros on macOS 26/27.

```sh
rustup target add aarch64-apple-darwin
CARGO_PROFILE_RELEASE_STRIP=none npm exec --workspace apps/web -- tauri build \
  --bundles app --target aarch64-apple-darwin &&
ditto -c -k --sequesterRsrc --keepParent \
  target/aarch64-apple-darwin/release/bundle/macos/Soma.app \
  target/Soma-macos-arm64.zip
```

Extract `target/Soma-macos-arm64.zip` and open `Soma.app` in Finder.

### Windows x64 installer and ZIP

Run in PowerShell from the repository root on Windows with the x64 MSVC Rust toolchain and the [Windows Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#windows).

```powershell
npm.cmd exec --workspace apps/web -- tauri build --bundles nsis --target x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw 'Soma build failed' }

$version = (Get-Content apps/web/src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
$installer = "target/x86_64-pc-windows-msvc/release/bundle/nsis/Soma_${version}_x64-setup.exe"
Compress-Archive -LiteralPath $installer -DestinationPath target/Soma-Windows-x64.zip -Force
```

Extract `target/Soma-Windows-x64.zip` and run the setup executable on x64 Windows.

Desktop builds include one compressed GLB containing all nine anatomy systems,
one combined JSON containing metadata and provenance, and readable source notices
in a separate `models/` resource directory. The packaged app reads those files offline.
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

## Lessons

Lessons combine localized reading, optional anatomy scenes and questions in ordered
learning steps. Each step can own its model selection and scene; preview follows the
same completion rules as the learner.

The desktop app stores each lesson as `lesson.json` and an `images/` folder under
`~/Library/Application Support/io.github.vandung-dev.soma/lessons/` on macOS or
`%LOCALAPPDATA%\io.github.vandung-dev.soma\lessons\` on Windows. Older drafts are
copied when the current WebView can still read them. The browser version stores
text in localStorage and images in IndexedDB. Export `.lesson.br` packages to back
up or share lessons offline. Imports validate package contents before replacing a draft;
legacy `.soma.br` packages remain readable. Rich text is sanitized locally, and
images are not uploaded. Rust owns lesson validation and package processing; the web
app owns editing, display and browser storage. See [Architecture](ARCHITECTURE.md)
for module boundaries.

Desktop preferences are stored in `settings.json` alongside the `lessons/`
directory. The browser version stores its preferences in localStorage.

## Wikipedia proxy

`npm run serve` and the packaged desktop app each include a Wikipedia proxy. Static hosting needs a deployed proxy:

```sh
VITE_WIKIPEDIA_PROXY_URL=https://your-server.example/wikipedia npm run build
```

## Backend direction

No backend. Future server work: Rust, with API/data contracts agreed first.

## References

- The anatomy information panel links to related sections of [OpenStax, Anatomy and Physiology 2e](https://openstax.org/details/books/anatomy-and-physiology-2e) (OpenStax, Rice University, 2022) alongside Wikipedia. These English web readings provide context for the selected structure or group; they do not imply that the book covers each model separately. The curated mappings live in `content/openstax-references.json`, ordered from specific topics to system overviews. No book text, images or PDF are bundled.
- [Architecture](ARCHITECTURE.md)
- Educational reference only; Vietnamese terminology and Wikipedia mappings await medical review.
- Original Soma code: [Soma Community and Commercial Use License](LICENSE). Third-party model, data, and dependency terms: [NOTICE](NOTICE), [attribution](apps/web/public/models/z-anatomy/ATTRIBUTION.md).
