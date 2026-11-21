---
name: rust-computation
description: Design or move CPU-intensive project algorithms among Rust, WASM, TypeScript, and Workers in Soma. Use when changing computation ownership or performance-sensitive numerical work.
---

# Rust computation workflow

1. Identify the algorithm, its inputs and outputs, CPU and GPU costs, and every caller before moving ownership. Ordinary UI loops do not need a Rust migration.
2. Keep portable domain and geometry algorithms in Rust, normally in `crates/renderer`, and expose browser commands through `crates/wasm`. Keep React UI, study navigation, DOM measurements, input capture, networking, browser resource lifecycle, and scheduling in TypeScript.
3. Keep large numerical buffers and intermediate animation state in Rust. Batch work across the WASM boundary; avoid per-structure transfers or rebuilding numerical arrays each frame.
4. Run long independent CPU work in Workers when it would block the UI. Reuse existing workers and transferable buffers. Rust/WASM on the main thread is not automatically asynchronous or parallel.
5. Keep GPU rendering in WebGL/GLSL and landmark inference in the existing MediaPipe worker. Rust handles interpretation of those landmarks; do not replace specialized engines solely to use Rust.
6. Preserve the shared browser/Tauri path, stable source IDs, validation, cancellation, reduced motion, and cleanup.
7. Cover moved algorithms with Rust tests and verify real WASM/runtime integration. Measure CPU/GPU work before claiming a speedup or moving additional hotspots.
