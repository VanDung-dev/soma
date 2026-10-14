# Human Atlas Rust: build guide

Run the commands below from the repository root.

## Requirements

- Rust 1.96+ and Cargo.
- Node.js 24.21+ and npm.
- Python 3.13+ and Blender for model regeneration.
- `wasm-pack` and the `wasm32-unknown-unknown` Rust target.
- For desktop builds, install the [Tauri prerequisites for your operating system](https://v2.tauri.app/start/prerequisites/).

Install the build tools and dependencies:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
npm ci
```

The repository includes the GLB/JSON files in `apps/web/public/models/`. Development and regular builds use these files directly. Python and Blender are needed for model regeneration; Python is also used by the optional Wikipedia content importer below.

## Development

Start the web app:

```sh
npm run dev
```

Open `http://localhost:5173/`. Press `Ctrl+C` to stop the server.

Start the desktop app:

```sh
npm run desktop:dev
```

The desktop command starts the frontend automatically. Run one development command at a time because both use port 5173.

## Build the web app

```sh
npm run build
```

This command compiles Rust to WASM, checks TypeScript, and builds the frontend with Vite. The output is in `apps/web/dist/`. Deploy it to a static host that supports the `application/wasm` MIME type.

If you edit Rust, GLSL, or the catalog while the web development server is running, rebuild WASM and reload the page:

```sh
npm run wasm:build
```

Both `npm run dev` and `npm run build` compile WASM before starting. Vite does not recompile Rust or GLSL when you edit the source files.

## Build the desktop app

```sh
npm run desktop:build
```

This command builds the frontend and a Tauri executable in release mode. With the default configuration, the executable is in `target/release/`: `human-atlas-rs` on macOS/Linux or `human-atlas-rs.exe` on Windows.

The command uses `--no-bundle`. It produces an executable without an installer, code signing, or notarization.

## Regenerate missing or updated models

You need Python 3.13+ and Blender. The pipeline has been tested with Blender 5.2.2 LTS. The importer uses Python from `.venv` when available, otherwise `python3` on macOS/Linux or `python` on Windows. Model export runs in Blender's bundled Python, so you do not need to install `bpy` in `.venv`.

Regenerate the GLB/JSON files, then rebuild the web app:

```sh
npm run models:import --workspace apps/web
npm run build
```

The pipeline prepares and extracts the source ZIP, exports GLB/JSON with Blender, validates the assets, writes them to `apps/web/public/models/z-anatomy/`, and updates `content/catalog.json`.

If `Z-Anatomy/Startup.blend` exists, the importer reuses it. Otherwise, it extracts a local `Z-Anatomy.zip` or downloads the ZIP from GitHub. Git ignores the source directory and ZIP; the exported GLB/JSON files remain tracked. Model import is a separate step and does not run during regular development or builds.

On macOS, the importer looks for Blender at `/Applications/Blender.app/Contents/MacOS/Blender`. On other systems, `blender` must be in `PATH`. To use different executables, set these environment variables (macOS/Linux example):

```sh
PYTHON_BIN=/path/to/python BLENDER_BIN=/path/to/blender npm run models:import --workspace apps/web
```

To download and extract the source without exporting GLB/JSON:

```sh
python3 apps/web/scripts/download-z-anatomy.py
```

This command does not need Blender. Replace `python3` with `.venv/bin/python` or another Python executable if needed. If `Z-Anatomy/` exists but lacks `Startup.blend`, rename or move that directory before running the importer again.

## Read Wikipedia in the app

The exporter keeps model names, geometry, materials, laterality, Latin names, and the source hierarchy. It no longer reads or bundles Z-Anatomy descriptions. Import also generates `content/anatomy-names.json`, a deduplicated name inventory linked to model IDs.

The reference panel embeds Wikipedia directly in an iframe. It supports expanding the reader, returning to the selected structure's original article, and opening that article on Wikipedia. Hovering previews the model name; clicking a model or choosing a tree entry opens its reference. Moving the pointer does not replace the article being read. Articles and images require an internet connection; they are not copied into model metadata or an application database.

`content/wikipedia-references.json` contains only the existing article URLs retained during migration. These mappings are not independently verified and may point to a broader article or section. Unmapped structures offer an explicit Wikipedia search link; the app does not guess an article from the first search result. Wikipedia remains reference material and may be inaccurate or outdated.

The optional `sync-wikipedia.py` staging tool remains available for future offline work and now reads this independent URL mapping. It does not feed the iframe or modify model packages.

## Checks

Build first to generate the WASM bindings, then run the tests and Rust checks:

```sh
npm run build
npm test
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all --check
```

Run the Python downloader tests without Blender:

```sh
python3 -m unittest discover -s apps/web/tests -p 'test_*.py'
```

## License

The project's original source code and build scripts are licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE) for the copyright notice.

Anatomy models and source-derived catalog data retain their source licenses. See the [Z-Anatomy attribution and component notices](apps/web/public/models/z-anatomy/ATTRIBUTION.md). Dependencies retain their own licenses.
