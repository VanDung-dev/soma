# Architecture

## Ownership

| Location | Responsibility |
| --- | --- |
| `crates/core` | Shared catalog schema and validation; library name: `catalog` |
| `crates/content` | Catalog/metadata JSON, terminology, reference links, search and tree snapshots; independent content WASM output |
| `crates/renderer` | Geometry, camera, gestures, animation, separation and snapping |
| `crates/wasm` | Viewer/gesture bindings, WebGL resources and rendering; no dependency on content |
| `apps/web/src-tauri` | Desktop host and native catalog command |
| `apps/web/src/pages/module-layout.tsx` | Shared header, workspace frame and host navigation |
| `apps/web/src/anatomy/catalog/` | Typed adapter to the Rust catalog store; UI snapshot types |
| `apps/web/src/anatomy/study/session.ts` | Study state, visibility, focus, reading and history |
| `apps/web/src/anatomy/viewer/` | Canvas lifecycle, loading, workers, DOM input and scheduling |
| `apps/web/src/anatomy/model-viewer.tsx` | Screen composition, preferences and camera mode |
| `apps/web/src/anatomy/wikipedia-reader.tsx` | Sandboxed reference reader |
| `scripts/models/` | Offline source preparation, Blender export and model validation/compression |
| `scripts/wikipedia/` | Offline Wikipedia snapshot tools |
| `apps/web/scripts/` | Web server, Wikipedia proxy and browser validation tools |
| `content/`, `apps/web/public/models/` | Catalog and model assets |

`core.ts` initializes content and viewer WASM independently. The content module
is built into `apps/web/src/content/`; the viewer module stays in
`apps/web/src/wasm/`. Geometry and hand workers load only the viewer module.
Each catalog handle owns its Rust data
and is freed on page disposal; separate viewer hosts use separate handles.
Metadata text goes directly to Rust for validation before geometry preparation.
Desktop builds package `models/z-anatomy/z-anatomy.glb.br` and `z-anatomy.json`
as Tauri resources. The JSON combines the provenance manifest and all nine
systems' metadata. Metadata text goes to the content module for validation,
then the worker prepares the requested structure IDs from the shared GLB.
The desktop viewer reads both files through Tauri's scoped asset protocol.
Web builds serve the same files over HTTP and cache the compressed GLB in
IndexedDB using the SHA-256 in the catalog model descriptors.
Rust retains source fields, names, membership, hierarchy and search indexes.
React receives requested tree/search/detail snapshots and command IDs, without
reconstructing the data indexes. Expansion, scrolling, focus and study history
remain UI state. Identity lists stay as strings through the catalog adapter,
runtime and session, exposed as `ViewerState.structureIds`. The model loader
yields prepared geometry directly. Content sorting uses ICU4X in Rust, with the host locale resolved
once per index rebuild for source-object ties; comparisons do not call back into
JavaScript. Search reuses a memchr substring finder per query word. The default
build does not require SIMD. Viewer commands accept JS arrays directly; legacy JSON string
inputs remain accepted at the Rust boundary. Small graphics preferences and
camera feedback serialization remain outside this content-data migration.

`core` uses library name `catalog` to
avoid Rust's built-in `core`; `::renderer` identifies the external crate in WASM.

## Data flow

```text
React UI → StudySession → ViewerRuntime → WASM → renderer
               ↑              │
               └── snapshots ─┘

Camera → MediaPipe worker → Rust HandGestureController → StudySession.control
```

## Viewer lifecycle

1. Create one `StudySession` and `ViewerRuntime` per host.
2. Connect the session; wire `onState` and `onPick`; call `start(roots)`.
3. Subscribe through `useSyncExternalStore`; route UI actions through the session.
4. Disconnect and dispose on unmount; create a new runtime for the next mount.

## Contracts

- React owns UI/DOM integration; Rust owns geometry, gesture interpretation and transforms.
- Snapshots and their collections are read-only; publish command state after runtime success.
- Preserve source IDs, validation, attribution and source loading order.
- Root membership: `model.structure_ids`; subfolder membership: `structure_ids`.
- Wheel zoom anchors at the cursor; keyboard zoom anchors at screen center.
- Preserve cancellation, cleanup, reduced motion and browser/Tauri compatibility.
- Release workers, camera tracks, animation frames, listeners and GPU resources on disposal.
- Hand controls: opt-in; left pans, right rotates, both zoom. Manual input/popovers suspend actions.
- Hand controls pause on hidden/unfocused pages and cannot move the camera during separation.
- Manual separation and automatic explosion are mutually exclusive; restoration runs in Rust.
- New study screens reuse the session/runtime and supply their own viewport geometry.

## Validation

Commands and setup: [README](README.md#checks).

| Area | Tests |
| --- | --- |
| Catalog/domain | `crates/core/src/lib.rs` |
| Content data/search | `crates/content/tests/` |
| Camera, geometry, gestures, assembly | `crates/renderer/tests/` |
| WASM hand state | `crates/wasm/tests/` |
| Session, loader, input, preferences | `apps/web/tests/*.test.mjs` |
| Rendering and browser interaction | `apps/web/tests/*.browser.mjs` |
| Offline source, exporter helpers and Wikipedia snapshots | `scripts/tests/test_*.py` |

Synthetic browser checks do not establish physical webcam or native WebView behavior.
