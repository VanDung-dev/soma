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
- `Soma-macos.zip` contains a universal app for Intel and Apple Silicon and requires macOS 15 or later.

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

## Lessons

Open **Lessons** and create a draft. Use **Add learning step** in the outline,
then write the step's title and explanation on the right. Choose one shared
anatomy model in Settings. Each step combines its content and a 3D scene; a new
step starts from the preceding authored scene. Enable an identification question
in the step's Settings to add answer choices. Lessons without a model remain
text-only. After selecting a model, use **Choose visible structures** to combine
groups or toggle individual parts using the Anatomy tree.

On desktop, the editor opens with a docked outline and settings below the writing
fields. Selecting or adding a step keeps both visible and leaves the model usable.
Drag each outline item's handle to reorder with mouse or touch; hold near the
scrolling area's edge to move through long outlines. With keyboard focus on the
handle, Space picks up/drops the item, arrows move it, Home/End choose the first/last
position, and Escape cancels without saving. Previous/next and Add learning step are also available
above the writing fields. The outline's Add button stays outside its scrolling list.
Outline and settings can be hidden independently; their preferences survive
preview, reopening and reload when browser storage is available. On small screens,
an open outline takes a compact area above the model and writing workspace.

The content field uses [TinyMCE Community self-hosted](https://www.tiny.cloud/get-tiny/self-hosted/), bundled from the `tinymce` npm package, with headings,
emphasis, lists, links and tables. No Tiny Cloud API key or remote editor assets
are needed. Vietnamese and English content are saved independently; existing
plain text keeps its literal meaning when edited or read. Rich HTML is filtered
with DOMPurify in the editor and player; scripts, styles, images, embedded frames
and unsafe link protocols are excluded. Editor resources load only when editing.
TinyMCE is configured for GPLv2+; dependencies retain their own licenses (NOTICE).
Builds include their notices under `licenses/`. Desktop allows inline styles for
TinyMCE's UI; its script and network source restrictions remain in effect.

While editing, use the Anatomy mouse controls to rotate, pan, zoom, Shift-drag
select, hold left to detach and move, or hold right to hide. Hiding updates the
section's visible structures. The shared explosion slider supports automatic
separation; restore manually moved parts with the restore button or T before
using it. Rotate, pan, zoom and adjust explosion, then press **Save step scene**
to store the camera, explosion and current visible set. Visibility changes also
autosave from the structure tree and hide gesture. Camera and explosion changes
stay temporary until explicitly saved. Manual offsets are not stored: restore
manually moved parts before saving. **Reset step scene** reapplies the authored
view. Source structure IDs and lesson/step IDs remain stable.

Preview runs the lesson as a learner sees it. In identification
exercises, part names in the 3D viewer become available after a correct answer.
The learner keeps one 3D viewer on the left and independently scrolling content
on the right. The learner outline is a docked panel: it stays open while selecting
steps or interacting with the model, until explicitly closed. Its visibility
preference is independent of the editor. Collapsing the model on mobile also
remains in effect when changing steps. Draft preview opens even when sections are
unfinished, shows missing settings, and permits skipping unfinished exercises.
JSON import/export also permits unfinished drafts for testing. Preview placeholders never modify
the saved draft. Changing steps applies their authored views with camera and
explosion transitions; manual camera input cancels the camera transition and
reduced motion applies the destination immediately. Learners can rotate, pan,
zoom, separate and hide parts during observation without changing the saved
lesson. Identification questions retain rotation and zoom but disable separation,
hiding and the explosion slider. The outline supports direct navigation up to
the first unanswered exercise. On small screens the model sits above the text
and can be collapsed. Text-only lessons use the full reading area. Legacy reading
sections inherit the preceding 3D section, with the first 3D section as the initial
scene. Saving a scene for a legacy reading section gives that step its own scene.
Use the library search to find drafts by title or description. A draft opens at
`/lessons/<id>/edit`, which reloads the saved draft in the same profile.
Drafts autosave in the current browser profile or desktop WebView. Export a
draft as `.json` to back it up or edit it directly while testing. Exports contain
the lesson object as indented UTF-8 JSON, without an archive, manifest or checksum.
Importing an existing lesson ID asks before replacing that draft and retains the
check against simultaneous changes from another tab. Files are limited to 512 KiB.
JSoma packaging is deferred; this version only imports and exports JSON files.

The editor keeps lesson and step IDs stable across edits. Model roots, step targets
and identification choices reference Soma catalog IDs. Optional step `visibleIds`
lists exact source structure IDs; when absent, the step uses its target membership.
Optional `view` stores a viewport-adapted camera pose and explosion level. Localized
text fields retain `vi` and `en` strings; optional `html: ["vi", "en"]` marks only the
locales containing rich HTML. An absent marker means plain text. Practice answers
are checked on the device.

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
