# Rust computation ownership

- Project-owned CPU-bound domain algorithms belong in Rust, with portable renderer logic in `crates/renderer` and browser-facing commands in `crates/wasm`. Keep React UI, DOM and input handling, networking, browser resource lifecycle, and scheduling in TypeScript.
- Keep GPU rendering in WebGL/GLSL and MediaPipe inference in its existing worker. Rust owns interpretation of landmarks; do not replace specialized engines solely to use Rust.
- Preserve the shared browser/Tauri path, stable source IDs, validation, cancellation, reduced motion, and cleanup across Rust/WASM boundaries.
- When adding or moving computation across Rust, WASM, TypeScript, or Workers, follow `.agents/skills/rust-computation/SKILL.md`.
