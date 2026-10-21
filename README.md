# Human Atlas Rust

Run commands from the repository root.

## Requirements

- Node.js 24.21+ and npm.
- Rust 1.95+, Cargo, `wasm-pack`, and the `wasm32-unknown-unknown` target.
- For the desktop app, install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.
- Python 3.13+ and Blender are needed only to regenerate models.

Install dependencies and required Rust tools once:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
npm install
```

## Development

Start the web app:

```sh
npm run dev
```

Open <http://localhost:5173/home> for the app overview; the root URL opens the same page.
The other pages are /anatomy, /lessons and /games. Lessons and Games have the shared frame ready for their own content.

Start the desktop app instead:

```sh
npm run desktop:dev
```

Run only one dev command at a time; both use port 5173.

## Build

Build the web app:

```sh
npm run build
```

The output is in `apps/web/dist/`. To run the build locally with its Wikipedia proxy:

```sh
npm run serve
```

Open <http://127.0.0.1:4173/home>.

Build the desktop app:

```sh
npm run desktop:build
```

The executable is written to `target/release/`. This command does not create an installer or sign the app.

## Graphics settings

Settings applies independent graphics controls immediately and saves them on the
device. Shadow quality offers High (2048px, sixteen filter samples), Low (1024px,
four samples), and Off. Lighting quality offers High with all three lights and
detailed reflections, or Low with diffuse main-light shading. Ambient light remains
available at both levels. Display sharpness offers High (100% render resolution)
and Low (50%); geometry and camera position stay unchanged. New preferences default
to shadows off, lighting/sharpness high, and a 60 FPS limit. Saved Balanced lighting
and sharpness values migrate to High; display-refresh frame limits migrate to 60 FPS.

The frame rate limit (60 or 30 FPS) applies while rendering.
Show actual FPS counts viewer frames over one-second intervals and reports zero
when idle; enabling the counter does not force continuous rendering. The background
grid can be disabled independently.

## Common problems

### Moving structures

Right-click uses the browser or WebView's native menu, including in Wikipedia.
Copy and paste use the native text controls and keyboard shortcuts.

Hold the left mouse button on a structure for one second, then drag it to inspect it.
The ring stays hidden for the first half second, then fills around the pointer
during the remaining half second. Drag immediately to rotate the model instead.
During separation, dragging other structures leaves the body still. Drag the background
to rotate, or drag with the right button to pan. Separated structures remain draggable.
Press **T** to restore separated structures without resetting the camera.
Return automatic explosion to 0% before moving individual structures; reassemble
manual positions before using automatic explosion again.
The information reader is available only for structures in movement mode or with a
separated position. Restoring a structure removes its extra reading controls.

**Esc** toggles Settings, **G** toggles the controls guide, and **F** opens structure
search. **Ctrl+[ / Ctrl+]** (Mac: **⌘[ / ⌘]**) navigates study history. Shortcuts do
not interrupt text entry; Escape dismisses an open menu or search before opening Settings.

### Rust or GLSL changes do not appear

Rebuild WASM, then reload the page:

```sh
npm run wasm:build
```

Vite does not rebuild Rust or GLSL after the dev server starts.

### Port 5173 is already in use

Stop the other dev server. The web and desktop dev commands use the same port and cannot run together.

### The Wikipedia panel is blank in a deployed or packaged app

The app needs the Wikipedia proxy. `npm run serve` includes it. For static hosting or a packaged desktop app, set `VITE_WIKIPEDIA_PROXY_URL` at build time to the URL of a deployed proxy, for example:

```sh
VITE_WIKIPEDIA_PROXY_URL=https://your-server.example/wikipedia npm run build
```

The packaged desktop app does not start the proxy server.

### `wasm-pack` or the WASM target is missing

Run the Rust setup commands from [Requirements](#requirements):

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
```

### Desktop build fails on a missing system dependency

Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system, then rerun the build.

## Regenerate models

Model files are already included, so this is not needed for normal development or builds. To regenerate them, install Python 3.13+ and Blender, then run:

```sh
npm run models:import --workspace apps/web
npm run build
```

The importer uses `.venv` Python when available. Blender performs the model export using its bundled Python. See the model importer scripts under `apps/web/scripts/` if regeneration fails.

## Checks

```sh
npm test
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all --check
python3 -m unittest discover -s apps/web/tests -p 'test_*.py'
```

## Project notes

- Read [Architecture and module ownership](ARCHITECTURE.md) before changing module boundaries or shared viewer state.
- The Vietnamese terminology glossary is a draft awaiting medical review. Existing Wikipedia URL mappings are not independently verified; treat both as reference data, not clinical validation.
- The original source code and build scripts use [Apache-2.0](LICENSE). See [NOTICE](NOTICE) and [model attribution](apps/web/public/models/z-anatomy/ATTRIBUTION.md) for source-derived assets.
