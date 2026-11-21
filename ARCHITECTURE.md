# Architecture

## Ownership

| Location | Responsibility |
| --- | --- |
| `crates/core` | Shared catalog and lesson types and validation; library name: `catalog` |
| `crates/content` | Catalog data, search, snapshots, lesson draft content and portable packages. Builds a separate content WASM module. |
| `crates/renderer` | Geometry, camera, gestures, animation and transforms |
| `crates/wasm` | Viewer bindings, WebGL resources and rendering; independent of content |
| `apps/web/src-tauri` | Desktop host, native catalog commands, lesson and settings files, and the local Wikipedia proxy |
| `apps/web/src/app.tsx`, `apps/web/src/pages` | App routing, shared module frame, navigation, panels and graphics state |
| `apps/web/src/settings` | Settings sections, controls guide and shortcut editor |
| `apps/web/src/anatomy` | Anatomy UI, catalog adapter, study session and viewer runtime |
| `apps/web/src/lessons` | Lesson library, editor, player, and shared code for the viewer, storage and archives |
| `scripts/models`, `scripts/wikipedia` | Offline model and Wikipedia data tools |
| `content`, `apps/web/public/models` | Catalog and model assets |

## Data flow

`AppRoute` tracks the active route and keeps the current workspace mounted while
Settings is open. `ModuleLayout` renders navigation and desktop window controls.
Settings shares language, theme, graphics, shortcuts and camera preferences with
the open workspace. Desktop stores settings in `settings.json` in its local app
data directory. Web stores settings in `localStorage`.
Anatomy and Lessons share the viewer implementation and preferences. Games
currently has an empty workspace.

The content and viewer WASM modules initialize independently. The browser opens
the catalog from content WASM. On desktop, Tauri supplies the catalog JSON to the
same WASM catalog adapter. Rust owns the catalog hierarchy, source identities and
search indexes. React receives snapshots and sends commands. The viewer loads
prepared geometry through viewer WASM. Desktop reads models from packaged Tauri
resources. Web loads them over HTTP and caches the compressed GLB in IndexedDB.

```text
React UI → StudySession → ViewerRuntime → WASM → renderer
               ↑              │
               └── snapshots ─┘

Camera → MediaPipe worker → Rust HandGestureController → StudySession
```

## Viewer lifecycle

Each host creates one `StudySession` and `ViewerRuntime`, connects them, subscribes
to snapshots, routes user actions through the session, then disconnects and disposes
both on unmount. A new mount gets a new runtime.

## Lesson storage and sharing

Web stores lesson draft metadata in `localStorage` and keeps referenced HTML,
scene and question tables, and images in IndexedDB. Desktop stores drafts and
their resources in the local app data directory under `lessons/`. Rust defines
the draft format, with HTML references based on content hashes and JSONL tables
for scenes and questions.

A worker calls the content WASM module to import and export `.lesson.br`
packages. Web exports through a browser download. Desktop uses a native save
dialog.

## Contracts

- React owns UI and DOM integration; Rust owns catalog validation, geometry, gesture interpretation and transforms.
- Treat snapshots as read-only and publish command state after runtime success.
- Preserve source IDs, attribution, validation and source loading order.
- Keep identity lists as structure ID strings through catalog, runtime and session.
- Wheel zoom anchors at the cursor; keyboard zoom anchors at screen center.
- Preserve cancellation, cleanup, reduced motion, and browser/Tauri compatibility.
- Dispose workers, camera tracks, animation frames, listeners and GPU resources.
- Hand controls are opt-in; they pause on hidden or unfocused pages and during separation.
- Manual separation and automatic explosion are mutually exclusive; Rust restores moved parts.
- Reuse the session/runtime for new study screens and provide their viewport geometry.
- Lessons store authored scenes per step and apply them through `StudySession`; learner controls do not change saved lesson data.
- Rust owns lesson validation, `.lesson.br` packaging and desktop file storage. TypeScript owns editing, UI sanitization, web storage and browser file interactions.

## Validation

See the [README](README.md#checks) for setup and commands.

| Area | Tests |
| --- | --- |
| Catalog and domain | `crates/core/src/lib.rs` |
| Content data and search | `crates/content/tests/` |
| Camera, geometry, gestures and assembly | `crates/renderer/tests/` |
| Viewer WASM hand state | `crates/wasm/tests/` |
| Desktop settings and lesson storage | `apps/web/src-tauri/src/settings.rs`, `apps/web/src-tauri/src/lessons.rs` |
| Session, loader, input and preferences | `apps/web/tests/*.test.mjs` |
| Rendering and browser interaction | `apps/web/tests/*.browser.mjs` |
| Offline source, exporter and Wikipedia snapshots | `scripts/tests/test_*.py` |

Synthetic browser checks do not establish physical webcam or native WebView behavior.
