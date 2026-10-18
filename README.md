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

Open <http://localhost:5173/>.

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

Open <http://127.0.0.1:4173/>.

Build the desktop app:

```sh
npm run desktop:build
```

The executable is written to `target/release/`. This command does not create an installer or sign the app.

## Common problems

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
