# Architecture

## Ownership

| Location | Responsibility |
| --- | --- |
| `crates/core` | Shared catalog and lesson types and validation; library name: `catalog` |
| `crates/content` | Catalog data, search, snapshots and lesson packages; independent content WASM |
| `crates/renderer` | Geometry, camera, gestures, animation and transforms |
| `crates/wasm` | Viewer bindings, WebGL resources and rendering; independent of content |
| `apps/web/src-tauri` | Desktop host, native catalog commands, lesson and settings files |
| `apps/web/src/pages` | Shared module frame, navigation, panels and graphics state |
| `apps/web/src/settings` | Settings sections, controls guide and shortcut editor |
| `apps/web/src/anatomy` | Anatomy UI, catalog adapter, study session and viewer runtime |
| `apps/web/src/lessons` | Lesson library, editor, player and shared lesson UI |
| `scripts/models`, `scripts/wikipedia` | Offline model and Wikipedia data tools |
| `content`, `apps/web/public/models` | Catalog and model assets |

## Data flow

`ModuleLayout` owns navigation and desktop window controls. The Settings page
shares language, theme, graphics, shortcuts and camera preferences with the open workspace.
Desktop stores these preferences in `settings.json` in its app data directory. Web uses localStorage.
Anatomy, Lessons and Games compose the shared workspace frame while owning their
content and session lifecycle. Anatomy and Lessons reuse viewer preferences and
runtime; Games currently has an empty workspace.

Content and viewer WASM are initialized independently. Rust retains catalog data,
source identity, hierarchy and search indexes; React receives snapshots and sends
commands. The viewer loads prepared geometry through the viewer WASM. In the desktop
build, model assets are packaged as Tauri resources; the web build serves them over
HTTP and caches the compressed GLB in IndexedDB.

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
- Rust owns lesson validation, `.lesson.br` packages and desktop file storage. TypeScript owns editing, sanitization, web storage and file dialogs.

## Validation

Setup and commands: [README](README.md#checks).

| Area | Tests |
| --- | --- |
| Catalog and domain | `crates/core/src/lib.rs` |
| Content data and search | `crates/content/tests/` |
| Camera, geometry, gestures and assembly | `crates/renderer/tests/` |
| WASM hand state | `crates/wasm/tests/` |
| Session, loader, input and preferences | `apps/web/tests/*.test.mjs` |
| Rendering and browser interaction | `apps/web/tests/*.browser.mjs` |
| Offline source, exporter and Wikipedia snapshots | `scripts/tests/test_*.py` |

Synthetic browser checks do not establish physical webcam or native WebView behavior.
