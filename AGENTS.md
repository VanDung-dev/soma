# Human Atlas Rust repository guidance

## Project structure

- Read `README.md` for setup, development, build, model regeneration, and validation commands.
- Read `ARCHITECTURE.md` before changing module boundaries, state ownership, or viewer reuse.
- The Rust workspace is defined in the root `Cargo.toml`: `crates/core` owns shared anatomy/domain data, `crates/renderer` owns rendering, `crates/wasm` exposes the browser-facing WASM layer, and `apps/web/src-tauri` contains the desktop host.
- The web application and its npm scripts live in `apps/web`; root web commands delegate to that workspace. The root `models:import` command runs the offline pipeline in `scripts/models/`.
- The unused Python backend has been removed. Before adding server-side features, read the Backend direction section of `README.md` and `tasks/plan.md`; use Rust and agree on API/data contracts for the first feature. Offline Python tools live in `scripts/models/` and `scripts/wikipedia/`, with tests in `scripts/tests/`; they do not run during normal web dev/build/serve.
- Catalog and generated model assets live under `content/` and `apps/web/public/models/`. Model regeneration is a separate pipeline that requires Python and Blender; do not regenerate assets as part of routine development or builds.

## Project constraints

- Keep browser and desktop behavior aligned where they share the WASM viewer, while accounting for host-specific behavior in the web app and Tauri shell.
- Do not add explanatory comments, doc comments, or other source-code annotations unless the user requests them. Keep existing comments when making unrelated changes; add comments only when requested or when required by an established project convention.
- Preserve source identity and licensing for anatomy models and catalog data. Check `NOTICE` and the relevant attribution files before changing or redistributing source-derived assets.
- Treat anatomy content as educational reference material. The Vietnamese terminology glossary is a draft awaiting medical review, and existing Wikipedia URL mappings are not independently verified; do not present either as clinically validated.
- For Python-based repository tasks, inspect and use the repository `.venv` when applicable. Blender export runs in Blender's bundled Python as documented in `README.md`.

## Validation

- Use the checks documented in `README.md` for the affected area. The normal web checks are `npm run build`, `npm test`, and Rust workspace checks; Python downloader tests do not require Blender.
- Run build, compile, and test commands synchronously with a timeout appropriate to the command. Report the completed command's exit status and relevant output.
