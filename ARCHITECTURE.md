# Architecture

## Ownership

| Location | Responsibility |
| --- | --- |
| `crates/core` | Catalog data and validation; library name: `catalog` |
| `crates/renderer` | Geometry, camera, gestures, animation, separation and snapping |
| `crates/wasm` | Browser bindings, WebGL resources and rendering |
| `apps/web/src-tauri` | Desktop host and native catalog command |
| `apps/web/src/pages/module-layout.tsx` | Shared header, workspace frame and host navigation |
| `apps/web/src/anatomy/catalog/` | Types, membership and hierarchy indexes |
| `apps/web/src/anatomy/study/session.ts` | Study state, visibility, focus, reading and history |
| `apps/web/src/anatomy/viewer/` | Canvas lifecycle, loading, workers, DOM input and scheduling |
| `apps/web/src/anatomy/model-viewer.tsx` | Screen composition, preferences and camera mode |
| `apps/web/src/anatomy/wikipedia-reader.tsx` | Sandboxed reference reader |
| `apps/web/scripts/` | Model pipeline, Wikipedia proxy and validation tools |
| `content/`, `apps/web/public/models/` | Catalog and model assets |

`core.ts` initializes WASM/catalog access. `core` uses library name `catalog` to
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
| Camera, geometry, gestures, assembly | `crates/renderer/tests/` |
| WASM hand state | `crates/wasm/tests/` |
| Session, loader, input, preferences | `apps/web/tests/*.test.mjs` |
| Rendering and browser interaction | `apps/web/tests/*.browser.mjs` |

Synthetic browser checks do not establish physical webcam or native WebView behavior.
