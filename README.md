# Human Atlas Rust

## Web development

Install Node.js 24.22+, Rust 1.96+, Cargo, and the WebAssembly target/tool once:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
npm install
```

Start the web app:

```sh
npm run dev
```

Open <http://localhost:5173/home>. The root URL opens the same page. Other pages
are `/anatomy`, `/lessons`, and `/games`; Lessons and Games are temporarily locked
in the interface. The development server builds WASM
automatically. Run only one dev command at a time; web and desktop both use port
5173.

To work on Rust or GLSL while the dev server is already running, rebuild WASM
and reload the page:

```sh
npm run wasm:build
```

## Backend development

The FastAPI application lives only in `apps/backend/`. Keep its routes,
database, and business logic there. Do not create `backend/`, `server/`, `api/`,
`apps/api/`, or `apps/server/` as another backend project.

Use Python 3.13. Create the repository Python environment and install
dependencies from the repository root:

```sh
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
```

Start the backend:

```sh
python3 server.py
```

The launcher uses the repository `.venv`, starts at <http://127.0.0.1:8000>,
and reloads when backend files change. Press Ctrl+C to stop it. On Windows,
create the environment with `py -3.13 -m venv .venv`, then use `python server.py`
and `.venv\Scripts\python.exe` for the install and test commands.

| Backend responsibility | Location |
| --- | --- |
| Application startup and shutdown | `apps/backend/app/main.py` |
| Router composition and `/api/v1` prefix | `apps/backend/app/api/router.py` |
| SQLite connection and request dependency | `apps/backend/app/database.py` |
| Authentication and permissions | `apps/backend/app/modules/auth/` |
| Accounts and user management | `apps/backend/app/modules/users/` |
| Lesson templates, content, and progress | `apps/backend/app/modules/lessons/` |
| Games content and results | `apps/backend/app/modules/games/` |
| Dashboard APIs | `apps/backend/app/modules/dashboard/` |
| Database migrations | `apps/backend/migrations/` |
| Backend tests and fixtures | `apps/backend/tests/` |
| Development database (Git-ignored) | `apps/backend/data/development.sqlite3` |

For each implemented domain, add a `router.py` for HTTP routes, `schemas.py`
for API data, `service.py` for business logic, and `models.py` for stored data
as needed. Register domain routers through `app/api/router.py`; keep one FastAPI
app. Database writes must commit transactions explicitly. The SQLite database
is created at startup, its path is independent of the working directory, and
each request gets and closes its own connection with foreign keys enabled.
ORM and migration tooling have not been selected yet.

Admin, user, and dashboard screens belong in `apps/web/src/`. Their APIs belong
to the relevant backend domains and must enforce permissions on the server.
Lessons reference structure IDs from the existing catalog; 3D models and
rendering stay in the frontend/Rust viewer. Use one lesson format for all
authors. The scaffold currently provides only the app, SQLite health check, and
domain package locations; authentication, lesson schemas, Games, dashboard,
production deployment, and production database remain to be implemented.

Check the backend:

```sh
.venv/bin/python -m unittest discover -s apps/backend/tests -t apps/backend -p 'test_*.py'
```

Tests use temporary databases, never the development database. The layout test
checks the canonical backend location, domain packages, and Python imports of
FastAPI outside `apps/backend/`. Health check: <http://127.0.0.1:8000/api/v1/health>.
OpenAPI UI: <http://127.0.0.1:8000/docs>; schema:
<http://127.0.0.1:8000/openapi.json>.

The web and desktop apps are not connected to this backend yet. Before
integration, agree on the API contract and configure its base URL, CORS, and
Tauri CSP for the actual origin.

## Build

Build the web app for static hosting:

```sh
npm run build
```

The output is in `apps/web/dist/`. To serve the local build with its Wikipedia
proxy, run:

```sh
npm run serve
```

Open <http://127.0.0.1:4173/home>.

For the desktop app, first install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/),
then run:

```sh
npm run desktop:dev
npm run desktop:build
```

Run one command at a time. The build writes an executable to `target/release/`;
it does not create an installer or sign the app.

## Optional: regenerate models

Model files are included, so normal development and builds do not need this
step. Regeneration requires Python 3.13 and Blender:

```sh
npm run models:import --workspace apps/web
npm run build
```

The importer uses `.venv` Python when available. Blender runs the model export
with its bundled Python.

## Checks

```sh
npm test
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all --check
python3 -m unittest discover -s apps/web/tests -p 'test_*.py'
```

## Experimental hand camera controls

Open `/anatomy`, wait for the model, then choose **Start camera** in the
viewer and allow camera access. Pinch thumb and index finger on the right hand and
move to rotate the view. Pinch the left hand to move the model across the screen
using camera pan. Pinch both hands and spread them to zoom in, or bring them
together to zoom out; two hands do not pan or rotate. Release to stop.
Mouse and keyboard input temporarily take priority;
controls pause while structures are separated. Choose **Stop camera** to stop.

Start each pinch inside the outlined viewer area, away from the camera card,
catalog, information panel and bottom controls. A pinch started outside remains
inactive until released and pinched again inside. Once captured, control continues
outside the outline until release or tracking interruption. A second hand joins
with a fresh pinch inside; releasing or losing either hand ends a two-hand session.
After manual input or tracking interruption, release before pinching again.

The camera video starts hidden and is used only for hand tracking. The compact
camera card shows a start/stop button, a scene-background toggle that starts off,
and any camera error. Turning it on shows the camera beneath the model; turning
it off keeps tracking active and restores the current graphics preference.

Translucent virtual hands appear over the model, including before a pinch. Their
palms and five articulated fingers follow 21 mirrored landmarks smoothed in Rust.
They stay aligned with the hidden camera image and account for letterboxing.
Hands retain the same contrast while idle and controlling. Labels distinguish
Ready, Outside area, Release to start and active mouse-button equivalents.
Hand silhouettes, wire outlines, joints and badges follow the shared theme palette
with contrasting edges. Their colors stay consistent across gesture states.
Action badges follow the palm center; a separate 22px dot marks the thumb–index
interaction point.
These are projected hand silhouettes, always drawn in front of the model; they do
not provide depth-based contact, collision, or behind-model occlusion.

A mouse icon shows the held left button for right-hand rotation or right button
for left-hand panning. Two-hand zoom shows spread arrows instead. A line
connects two pinched hands; its center shows **Zoom in** or **Zoom out** while
zooming. Releasing a pinch returns its cursor to Ready. Lost or stale tracking,
manual input and camera shutdown clear the markers.

Camera access requires HTTPS or localhost and a compatible browser. Start with
current desktop Chrome/Edge. Native Tauri WebView camera access and Safari need
separate device checks. Camera access is opt-in on every visit; leaving the viewer
stops camera tracks and the worker. Video is processed locally, without uploads.

MediaPipe runs in a worker and passes landmarks to Rust/WASM. Rust owns pinch
hysteresis, smoothing, gesture state and camera deltas. The browser adapter passes
commands through the existing study session and viewer. The pinned model is in
`apps/web/public/hand-input/`; its source and checksum are in `ATTRIBUTION.md`
beside it. MediaPipe runtime assets are bundled from npm during the web build.

With Vite running, the browser console probe below checks the real Rust/WASM
gesture binding and MediaPipe worker inference on a blank image without opening
the camera:

```js
(await import('/tests/hand-input.browser.mjs')).checkHandInput()
```

After the anatomy viewer loads and with hand controls off, `checkHandCameraBridge()`
from the same module checks Rust commands reaching the live viewer and camera
cleanup using a synthetic canvas stream, without requesting a physical camera.
Pass `"right"` to check right-hand rotation; the default checks left-hand panning.
`previewVirtualHands()` renders an open-hand fixture through Rust/WASM and returns
a cleanup function; pass `"rotate"`, `"pan"` or `"zoom"` to preview the corresponding active hands.

## Graphics settings

Settings applies independent graphics controls immediately and saves them on the
device. Shadow quality offers High (2048px, sixteen filter samples), Low (1024px,
four samples), and Off. Lighting quality offers High with all three lights and
detailed reflections, or Low with diffuse main-light shading. Ambient light remains
available at both levels. Display sharpness offers High (100% render resolution)
and Low (50%); geometry and camera position stay unchanged. New preferences default
to shadows off, lighting/sharpness high, and a 60 FPS limit. Saved Balanced lighting
and sharpness values migrate to High; display-refresh frame limits migrate to 60 FPS.

The frame rate limit (60 or 30 FPS) applies while rendering.
Show actual FPS counts viewer frames over one-second intervals and reports zero
when idle; enabling the counter does not force continuous rendering. The background
grid can be disabled independently.

## Common problems

### First visit to Anatomy

After the model is ready, Anatomy opens a five-step introductory guide. Practice
in the highlighted area while the rest of the page is blurred. The guide follows
each target; keycaps show the main actions and More details expands the explanation.
Use Next to continue. Finish, Skip, and Escape save the
decision on this device. Leaving the page before closing the guide keeps it pending.
Open Help (G) and choose Replay the introductory guide to see it again.
Touch devices get instructions for their supported gestures; holding for one second
to separate a structure currently requires a mouse.

### Moving structures

Right-drag on the 3D canvas pans the view; the canvas blocks browser context menus.
Elsewhere, including Wikipedia, right-click uses the browser or WebView's native menu.
Copy and paste use the native text controls and keyboard shortcuts.

Hold the left mouse button on a structure for one second, then drag it to inspect it.
The ring stays hidden for the first half second, then fills around the pointer
during the remaining half second. Drag immediately to rotate the model instead.
During separation, dragging other structures leaves the body still. Drag the background
to rotate, or drag with the right button to pan. Separated structures remain draggable.
Press **T** to restore separated structures without resetting the camera.
Bring a separated piece near its original alignment with a neighboring visible
piece. The neighbor is outlined and a release hint appears; release to connect.
Connected pieces move as a group. Hold one for a second to detach it again.
Connecting to the assembled body returns the pieces to their source positions.
This trial uses source bounds and relative positions, not authored anatomical
connector data, so suggestions are approximate.
Return automatic explosion to 0% before moving individual structures; reassemble
manual positions before using automatic explosion again.
The information reader is available only for structures in movement mode or with a
separated position. Restoring a structure removes its extra reading controls.

**Esc** toggles Settings, **G** toggles the controls guide, and **F** opens structure
search. **Ctrl+[ / Ctrl+]** (Mac: **⌘[ / ⌘]**) navigates study history. Shortcuts do
not interrupt text entry; Escape dismisses an open menu or search before opening Settings.

### The Wikipedia panel is blank in a deployed or packaged app

The app needs the Wikipedia proxy. `npm run serve` includes it. For static hosting
or a packaged desktop app, set `VITE_WIKIPEDIA_PROXY_URL` at build time to the URL
of a deployed proxy, for example:

```sh
VITE_WIKIPEDIA_PROXY_URL=https://your-server.example/wikipedia npm run build
```

The packaged desktop app does not start the proxy server.

### `wasm-pack` or the WASM target is missing

Run the Rust setup commands in [Web development](#web-development):

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
```

### Desktop build fails on a missing system dependency

Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your
operating system, then rerun the build.

## Project notes

- Read [Architecture and module ownership](ARCHITECTURE.md) before changing module boundaries, state ownership, or viewer reuse.
- The Vietnamese terminology glossary is a draft awaiting medical review. Existing Wikipedia URL mappings are not independently verified; neither should be treated as clinical validation.
- The original source code and build scripts use [Apache-2.0](LICENSE). See [NOTICE](NOTICE) and [model attribution](apps/web/public/models/z-anatomy/ATTRIBUTION.md) for source-derived assets.
