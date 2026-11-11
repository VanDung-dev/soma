# Architecture

## Ownership

| Location | Responsibility |
| --- | --- |
| `crates/core` | Shared catalog and lesson schema/validation; library name: `catalog` |
| `crates/content` | Catalog/metadata, search, snapshots, lesson packages and image validation; independent content WASM output |
| `crates/renderer` | Geometry, camera, gestures, animation, separation and snapping |
| `crates/wasm` | Viewer/gesture bindings, WebGL resources and rendering; no dependency on content |
| `apps/web/src-tauri` | Desktop host and native catalog command |
| `apps/web/src/pages/module-layout.tsx` | Shared header, workspace frame and host navigation |
| `apps/web/src/pages/workspace-layout.tsx`, `workspace.css` | Workspace root, overlay/inline menu geometry, sidebar buttons and shared panel/control styling |
| `apps/web/src/pages/workspace-panels.tsx`, `graphics-controls.tsx`, `camera-guide.tsx` | Shared settings and help presentation, composed with each module’s controls and capabilities |
| `apps/web/src/pages/use-graphics-settings.ts` | Persisted graphics preferences shared by Anatomy and Lessons |
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

`ModuleLayout` owns application navigation, language, theme and desktop window controls.
Within that frame, Anatomy, Lessons editor/player and Games compose `WorkspaceLayout`.
`WorkspaceMenu` supplies navigation, title and action slots with overlay or inline placement;
`SidebarToggle`, `WorkspaceSettings` and `WorkspaceHelp` share presentation and accessibility.
The workspace stylesheet loads through `pages/` independently of Anatomy’s stylesheet.
Games currently uses only the empty workspace root and remains unavailable in navigation.

Modules own their content, sidebar state, shortcuts and viewer/session lifecycle. Anatomy
adds camera-device controls and its onboarding replay to the shared panels; Lessons supplies
authoring/reading guidance and enables manipulation help only in the editor. The shared
graphics controls use the existing viewer settings contract and storage key. Viewer runtime,
camera commands and graphics validation remain in the existing anatomy viewer modules.

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
- The lesson editor uses a borderless canvas behind the workspace panels and measures
the remaining focus frame for camera fitting. Its composition follows that frame without
changing the authored pose. Outline transitions, HUD wrapping and structure details resize
the frame through the shared runtime observer; feedback reuses Anatomy components and styles.
The editor mounts its empty renderer on lesson details, retains that canvas across details
and steps, and adds lesson geometry to the same renderer when needed. Details and steps
without a model hide anatomy and its controls while keeping the background visible.
Preview and student view use the same persistent background and measured focus frame.
Their outline and reading layout animate before applying the next authored scene;
text-only steps and mobile model collapse hide anatomy without replacing the canvas.
Lessons render the spherical grid with a separate full-viewport camera so model fitting
cannot stretch the background. Its center follows the model's focus, including panel
transitions and panning, and returns to the canvas center when no model is visible.
It follows model rotation and manual zooming. Reset fits the model to the current focus frame.
- Lessons apply authored scenes through `StudySession.applyScene`; Rust validates and restores
visibility, camera pose and explosion. Camera poses adapt to the host viewport. Learner controls
change only the active session; the editor saves the selected step's content, `modelIds` and
scene together. Each visual step owns its model selection and scene. Legacy lesson-level
`modelId`, `modelIds` and optional `scene` remain fallbacks for older lessons and lesson details.
Per-step `showModel` controls authored visibility without deleting the scene. Lessons derive
the required source systems from authored structure IDs and load them through the shared runtime.
The player and author preview share camera-only input: authored visibility and
explosion remain locked. Per-step `mode` selects content, questions or both without
deleting inactive data. `questions` stores localized prompts, choices and explanations
with stable IDs. Rust validates all question shapes and the completeness of active
questions; the player requires all active questions to pass. Legacy identification
steps adapt to one question and retain their scene when edited into the new format.
- Lesson JSON uses localStorage with optimistic replacement checks; binary images use
IndexedDB under immutable content-hash paths. Rich HTML is sanitized before display;
blob URLs are scoped to an opened lesson or library cover and revoked on disposal.
Lesson details use plain text and an optional `cover` image reference; covers share
the existing image storage, validation and package resource contract. Rust core owns
lesson schema, scenes, target/choice validation, image references and filenames.
Rust content owns USTAR, Brotli, package manifests, image decoding/hashes and limits;
the worker calls its WASM bindings. New image uploads use the bundled Squoosh WebP
encoder in that worker, after Rust validates the original and before Rust validates
and hashes the smaller result. Worker progress events report compression without
settling the image job; the UI also reports reading and storage stages. Package
import/export preserves image bytes, including resources in inactive question content.
TypeScript handles UI, DOM sanitization, browser
storage, file dialogs and binary transfer. The `.lesson.br` package contains
manifest metadata, lesson JSON and referenced images. Filename defaults to the
localized title; identity remains inside lesson JSON. Import validation precedes
draft replacement; legacy `.soma.br` packages remain readable by the package decoder,
while the library imports `.lesson.br` packages and rejects standalone JSON. Model assets and TinyMCE's
runtime stay in the application.

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
