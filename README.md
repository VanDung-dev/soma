# Human Atlas Rust

Anatomy viewer: React, Rust/WASM and Tauri.

## Setup

Node.js 24.22+, Rust 1.96+ and Cargo.

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

- [Architecture](ARCHITECTURE.md)
- Educational reference only; Vietnamese terminology and Wikipedia mappings await medical review.
- Code: [Apache-2.0](LICENSE). Model/data terms: [NOTICE](NOTICE), [attribution](apps/web/public/models/z-anatomy/ATTRIBUTION.md).
