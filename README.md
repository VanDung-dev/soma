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

Open **Lessons** and create a draft. **Lesson details** contains a title, a plain
short description and an optional cover image for the library card. It has no 3D
viewer or rich-text editor. Covers use the same local image storage, validation,
compression and package resources as content images.

Use **Add learning step** in the outline, then write the step's title and explanation
on the right. Use **Find and add 3D structures** in the model HUD to choose a part or group directly; Soma selects its
anatomy systems automatically, including groups and scenes spanning several systems.
**3D settings** in that HUD combines system selection, the structure tree and
show/hide/reset actions. The editor has one structure search; choosing an existing
part also opens its information bar along the bottom of the canvas. Each step has
a **Show the 3D model in this step** option. Hiding it preserves the authored scene,
and the learner gets the full reading area for that step. New steps start with empty
content and no model; choose **3D settings** to configure a scene or copy the previous
step's scene. Step options support **Content / No questions**,
**No content / Questions** and **Content / Questions**. Switching modes retains
the hidden content and questions. Each step can have several questions, each with
a prompt, at least two answer choices, one correct answer and an optional explanation.
Questions can be used without a 3D model. Legacy identification questions remain readable.

On desktop, the editor opens with a docked outline and step options below the writing
fields, above the remove button. Selecting or adding a step keeps the outline visible and leaves the model usable.
Drag each outline item's handle to reorder with mouse or touch; hold near the
scrolling area's edge to move through long outlines. With keyboard focus on the
handle, Space picks up/drops the item, arrows move it, Home/End choose the first/last
position, and Escape cancels without saving. Previous/next and Add learning step are also available
above the writing fields. The outline's Add button stays outside its scrolling list.
The outline can be hidden; its preference survives preview, reopening and reload
when browser storage is available. On small screens,
an open outline takes a compact area above the model and writing workspace.

The step content field uses [TinyMCE Community self-hosted](https://www.tiny.cloud/get-tiny/self-hosted/), bundled from the `tinymce` npm package, with headings,
emphasis, lists, links, tables and local images. The image button opens TinyMCE's
image dialog; use **Browse files** beside Source to choose a PNG, JPEG or WebP.
Before storage, a worker uses Squoosh's bundled WebP encoder to compress new
images at their original resolution. PNG uses lossless compression, including
transparency; JPEG uses quality 85. The encoded image is used only when smaller
than the original. Existing WebP and animated PNG files stay unchanged, as do
images already stored or imported in lesson packages. Browsers without worker
canvas/image decoding keep the original. The selected codec is vendored in
`apps/web/src/lessons/shared/codecs/webp/`; the separate `squoosh-dev/` checkout is not
needed for development or builds.
Cover uploads and the image dialog show reading, compression and storage states
with an indeterminate progress indicator. The image dialog stays blocked until
processing finishes, and becomes usable again if processing fails.
Images are stored on the device, without uploading to a server. No Tiny Cloud API key or remote editor assets
are needed. Vietnamese and English content are saved independently; existing
plain text keeps its literal meaning when edited or read. Rich HTML is filtered
with DOMPurify in the editor and player; scripts, styles, remote images, embedded frames
and unsafe link protocols are excluded. Pasting image data and image drag/drop are
not enabled. Editor resources load only when editing.
TinyMCE is configured for GPLv2+; dependencies retain their own licenses (NOTICE).
Builds include their notices under `licenses/`. Desktop allows inline styles for
TinyMCE's UI; its script and network source restrictions remain in effect.

While editing, use the Anatomy mouse controls to rotate, pan, zoom, Shift-drag
select, hold left to detach and move, or hold right to hide. Hiding updates the
section's visible structures. The shared explosion slider supports automatic
separation; restore manually moved parts with the restore button or T before
using it. Each learning step owns its model selection and scene. Rotate, pan, zoom,
adjust explosion and visibility, then press **Save lesson** in the top bar to save
the whole lesson, including its details, every step's content, model selection,
questions and scene. All edits stay in one draft until **Save lesson** is pressed;
successful saves show a confirmation and failed saves keep the draft open with an error.
Manual offsets are not stored: restore manually moved parts before saving. **Reset step
scene** restores the section's last saved model selection, visibility, camera and explosion,
including returning manually moved parts to their original positions. Unsaved text and questions
remain unchanged. Saving the lesson updates the scene used by this reset. Source structure IDs and lesson/step IDs remain stable.

Preview runs the same player and completion rules as student learning. Every
enabled question in a step must be answered correctly before proceeding; incorrect
answers can be retried and explanations appear after a correct answer.
Both editor and preview exit to the lesson library. Preview has a separate **Edit**
button to return to the active editor, an outline toggle on the left and a centered
lesson heading. Both toolbars use equal side columns and the shared nested radii.
Structure search and the explosion slider are editor-only. The player permits
rotation, panning, zoom and resetting the authored scene. It does not permit
structure search, selection, separation, hiding or changing the authored explosion.
The learner keeps one 3D viewer on the left and independently scrolling content
on the right. The learner outline is a docked panel: it stays open while selecting
steps or interacting with the model, until explicitly closed. Its visibility
preference is independent of the editor. Collapsing the model on mobile also
remains in effect when changing steps. Draft preview opens even when sections are
unfinished and shows missing settings; unfinished steps cannot be skipped.
Package import/export also permits unfinished drafts for testing. Preview placeholders never modify
the saved draft. Changing steps applies their authored views with camera and
explosion transitions; manual camera input cancels the camera transition and
reduced motion applies the destination immediately. Learner camera interactions
never change the saved lesson. The outline supports direct navigation up to
the first unanswered exercise. On small screens the model sits above the text
and can be collapsed. Text-only lessons use the full reading area. Legacy reading
sections inherit the preceding 3D section, with the first 3D section as the initial
scene. Saving a scene for a legacy reading section gives that step its own scene.
Use the library search to find drafts by title or description. A draft opens at
`/lessons/<id>/edit`, which reloads the saved draft in the same profile.
Saved lesson text is stored in localStorage in the current browser profile or desktop
WebView; binary images use IndexedDB. Changes remain in the editor draft until **Save
lesson**. Export a draft as `<lesson title>.lesson.br`
to back up or share its content and images offline. The filename uses the current
interface language with the other title as fallback; unsafe filename characters
are replaced. Untitled drafts receive a readable default name. The stable lesson
ID stays inside `lesson.json`, so renaming a file does not change its identity.
This experimental format is a USTAR archive compressed with Brotli, containing
`manifest.json` (`format: "soma-lesson"`, `version: 1`),
the raw lesson object in `lesson.json`, and the referenced `images/<sha256>.<ext>`
files. TinyMCE HTML stays in the lesson's localized fields; the editor library and
3D models are supplied by the app. Opening a package requires the referenced
model catalog to be available in Soma.

Rust owns the lesson schema, authored-view checks, target/choice validation,
scene inheritance, image references, filename generation, TAR/Brotli, manifest
validation, image decoding, SHA-256 and resource limits. Package and image work
run in a worker using the content WASM module, independently of the viewer WASM.
TypeScript handles the browser UI, TinyMCE/DOMPurify, storage and binary transfer.
Temporary
blob URLs are used only for display; saved HTML retains package paths. Exports
include only referenced images. Unused images stay with a draft to support undo;
deleting the draft also removes its stored images. A failed cleanup can leave
unused image bytes on the device, without affecting the exported package.
Import checks the archive paths, regular-file types, duplicate entries, header
checksums, image hashes and decoded formats before replacement. Limits are 64 MiB
for the compressed file and expanded archive, 2 MiB for lesson JSON, 128 images,
and 8 MiB / 16 megapixels / 8192 pixels per side for each image. Animated WebP and
SVG are excluded. Brotli can reduce JSON/HTML well; savings on already compressed
images depend on the source image.

Legacy `.soma.br` packages remain importable; new exports use `.lesson.br` and a
lesson-specific manifest, leaving other package types available for future Games.
The library accepts `.lesson.br` files through the file picker or by dropping a
single package anywhere on the library page. Standalone `.json` imports are no
longer supported; JSON remains an internal part of the package. Rust validates
the filename and contents. Importing an
existing lesson ID asks before replacing that draft and retains the check against
simultaneous changes from another tab. Browser storage is not a backup: export
important drafts before clearing app/site data. The separate JSoma design remains
deferred.

The editor keeps lesson and step IDs stable across edits. Model roots, step targets
and identification choices reference Soma catalog IDs. Optional step `visibleIds`
lists exact source structure IDs; when absent, the step uses its target membership.
Optional `view` stores a viewport-adapted camera pose and explosion level. An optional
legacy lesson-level `scene` remains readable as a scene fallback. Optional `cover`
references a packaged image, and each step's optional `showModel` controls whether
its 3D pane appears. Required model
systems are derived from the saved source structure IDs. Localized
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
