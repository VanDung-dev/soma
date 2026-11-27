# Architecture

## Ownership

| Location | Responsibility |
| --- | --- |
| `crates/core` | Shared catalog types and validation, lesson validation, edit rules and progress. The Rust library is named `catalog`. |
| `crates/content` | Catalog queries and indexes, model metadata, lesson drafts and `.lesson.br` packages. Exposes the content WASM module. |
| `crates/renderer` | Geometry, camera, gesture interpretation, animation and transforms. |
| `crates/wasm` | Browser viewer bindings, WebGL rendering and GPU resources. Uses `renderer`. |
| `apps/web/src/app.tsx`, `apps/web/src/pages/`, `apps/web/src/settings/` | Routing, workspace layout, desktop window controls and shared preferences. |
| `apps/web/src/catalog/` | TypeScript catalog adapter, structure search and tree shared by Anatomy and the lesson editor. |
| `apps/web/src/viewer/` | Shared `StudySession`, `ViewerRuntime`, model loading and viewer controls. |
| `apps/web/src/anatomy/` | Anatomy workspace, hand camera and reference panels. |
| `apps/web/src/lessons/` | Lesson library, editor, player and host integration for drafts and archives. |
| `apps/web/src-tauri/` | Desktop commands, lesson files, settings, packaged resources and local Wikipedia proxy. |
| `content/`, `apps/web/public/models/` | Catalog data, prepared models and attribution. |
| `scripts/models/`, `scripts/wikipedia/` | Offline model and reference-data tools. |

## Runtime

The content and viewer WASM modules initialize independently in `apps/web/src/core.ts`. The browser opens the catalog bundled in content WASM. Tauri passes native catalog JSON to the same adapter. Rust owns the hierarchy, search indexes and source identities.

```text
Anatomy and lesson editor → Catalog adapter → content WASM → core
Anatomy and Lessons → StudySession → ViewerRuntime → viewer WASM → renderer
Camera → MediaPipe worker → HandGestureController → StudySession
```

Settings keeps the active workspace mounted and shares its preferences with it. The web stores preferences in `localStorage`. Tauri stores them in `settings.json` under app data.

## Viewer lifecycle

Each mounted viewer connects a `StudySession` to a `ViewerRuntime` and subscribes to read-only snapshots. TypeScript owns DOM input, viewport measurement, frame scheduling and cleanup. Rust applies focus, authored scenes and overview commands and returns visibility updates. It also handles drag snapshots, snapping and rollback. Anatomy restores its saved hidden structures. Lessons applies the authored scene for the active step.

The Rust catalog plans model loads and validates bundle metadata before the geometry worker processes it. The runtime commits metadata after the viewer accepts the geometry. Web fetches models over HTTP and caches compressed GLBs in IndexedDB. Packaged Tauri reads models from its resources. The lesson editor can also load metadata from combined bundles or individual model files.

- Pass source structure IDs as strings through the catalog, session and runtime. Preserve attribution and model loading order. Publish command state after runtime success.
- Preserve cancellation and reduced motion. Dispose workers, camera tracks, animation frames, listeners and GPU resources.
- Wheel zoom anchors at the cursor. Keyboard zoom anchors at the screen center.
- Hand controls are opt-in and pause when the workspace loses focus, is hidden or enters separation.
- Manual separation and automatic explosion are mutually exclusive. Rust restores moved parts.

## Lesson editor

- `LessonDetails` renders the language and summary fields and embeds the cover editor. Both pass changes back to the lesson draft through `onChange`. [Details form](apps/web/src/lessons/editor/details.tsx)
- `LessonCoverEditor` handles file selection, drag and drop, replacement and cropping. It adds images through the shared lesson image provider and reports the cover path and crop to the draft. Its controls and crop dialog have a dedicated stylesheet. [Cover editor](apps/web/src/lessons/editor/cover-editor.tsx) · [Editor styles](apps/web/src/lessons/editor/cover-editor.css)
- The editor preview and library cards share cover rendering and crop bounds. Their common cover styles live in the Lessons stylesheet. [Cover rendering](apps/web/src/lessons/editor/cover.tsx) · [Shared styles](apps/web/src/lessons/style.css)

## Lesson storage and sharing

| Host | Draft storage | Export |
| --- | --- | --- |
| Web | Metadata in `localStorage`. Referenced HTML, scene and question tables, and images in IndexedDB. | Browser download |
| Tauri | Drafts and resources under `lessons/` in app data. | Native save dialog |

Rust defines the draft format, including content hashes for HTML references and JSONL for scene and question tables. A worker uses content WASM for `.lesson.br` import and export. On import, Rust deduplicates images, rewrites references and chooses which files to write.

Rust owns lesson validation, scene and question edit rules, progress and draft preparation. TypeScript owns editor interaction, browser timers, sanitization and web storage. The reader stores progress in `localStorage` on both hosts. Learner controls affect the live viewer while authored scenes remain part of the saved lesson.

## Validation

- Rust integration tests live in each crate's `tests/` directory. Tauri settings and lesson tests live in `apps/web/src-tauri/src/`.
- Node and browser tests live in `apps/web/tests/`. Browser tests use synthetic camera input. Physical webcams and native WebViews require separate verification.
- Offline model and Wikipedia tests live in `scripts/tests/`.

[Setup and check commands](README.md#checks)
