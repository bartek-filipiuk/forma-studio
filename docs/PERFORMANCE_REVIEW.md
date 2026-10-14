# Performance and small UX improvements — 2026-10-14

The user's Compose workspace was stopped with `docker compose stop`. No project,
volume or imported asset was deleted. Checks used a temporary localhost-only Vite
production preview on port 18181, with the backend remaining stopped. This review
preserves React/Three/R3F, the document schema and the native CAD/worker boundary.

## Findings and changes

### Stop rendering a stationary scene

The Canvas previously ran continuously, including shadow rendering and DOM label
updates. It now uses R3F's `frameloop="demand"`. The installed Drei orbit and
transform controls already invalidate on change, including damping. Text label
updates and imperative STL material changes explicitly request a frame. Memoizing
the Scene entry prevents unrelated parent updates from rebuilding its element tree.

This follows the [R3F on-demand rendering guidance](https://r3f.docs.pmnd.rs/advanced/scaling-performance).
It does not lower geometry quality, shadow resolution or pixel ratio.

A before/after production-preview measurement used the default seven-part PICO,
Chromium software WebGL, a 1440 × 900 viewport, ten seconds to settle and a
requested three-second idle sample:

| Measurement | Before | After |
| --- | ---: | ---: |
| WebGL draw calls during idle sample | 806 | 0 |
| CDP main-thread TaskDuration delta | 3,446.526 ms | 2.154 ms |

The overloaded baseline can stretch the sampling interval; this is not a CPU
percentage, hardware FPS, battery-life or Core Web Vitals benchmark. The robust
result is that drawing stops while idle and resumes when the scene changes.
`scripts/measure-idle.mjs` now also records actual elapsed time for future runs.

### Load import code only when needed

STLLoader and GLTFLoader use dynamic imports. The initial production JavaScript
entry decreased from **1,310,455 to 1,267,614 bytes** (about 3.3%, uncompressed).
The deferred chunks are 2,936 bytes for STL and 43,798 bytes for GLB. The complete
application is not smaller; less import-specific code is downloaded at startup.

Changing an STL color previously fetched and parsed the original file again.
It now changes the existing material, with no new file request. GLB retains its
source materials. Unmount/abort cleanup disposes imported geometry, materials,
textures and ImageBitmap resources; a load finishing after cancellation is also
released. This removes a visible reload and prevents abandoned imports retaining
resources. No long-session memory benchmark is claimed.

### Cache immutable frontend files

Caddy now gives hashed `/assets/*` build files a one-year immutable cache policy.
HTML uses `no-cache` so a later deployment discovers current hashed filenames.
The API caching policy is unchanged. Caddy configuration validation passed in an
isolated container without starting the application stack.

### Low-cost UX additions

- Failed chat requests restore the command for editing/resending. A newer draft
  entered while waiting is preserved. There is no automatic retry.
- Empty catalog searches explain the result and offer one action to reset both
  query and category. Leading/trailing search whitespace is ignored.
- The inspector includes an expandable keyboard shortcut reference, including
  save, cancel, duplicate, view framing and transform tools.
- The chat collapse button exposes its expanded state to assistive technology.

## Validation

- TypeScript and Vite production build: passed.
- Frontend domain suite: 5 passed.
- Final selected Playwright run: **7 passed in 50.8 seconds**. Five isolated checks
  cover idle rendering and scene interactions/resizing, catalog reset, chat failure
  and draft preservation, STL recolor/delete/undo without repeated file requests,
  and embedded GLB loading with source material preservation. Two existing local
  editor checks cover dimensions/cancellation/validation and names/undo.
- The new renderer/import checks recorded no uncaught page errors. GLB evidence is
  a small embedded untextured fixture; large textured assets and sustained memory
  usage still need representative-file testing.
- Desktop and 390 × 844 mobile layouts inspected. This is a narrow layout check,
  not certification of all mobile editing gestures.
- HTTP responses in the new browser tests are explicit fixtures; real WebGL,
  import parsing, UI operations and local storage run in the browser. They do not
  replace the earlier live PostgreSQL/S3/Celery acceptance.

## Next candidates, deliberately deferred

1. **Large uploads:** `main.py` uses an async upload endpoint, then performs
   synchronous validation and storage I/O. Move that stage to a thread pool and
   measure concurrent health/chat latency with a representative large STL.
2. **Larger projects:** several panels subscribe to the entire Zustand store.
   Profile slider/color interactions with a large document before narrowing
   selectors or changing synchronous local persistence. The current small scene
   does not justify a store rewrite.
3. **Large CAD previews/assets:** preview meshes currently travel as job JSON;
   content-addressed assets and streaming downloads would reduce memory and
   repeated payload cost. This needs representative files and backend tests.
4. **Long generation jobs:** CAD and Meshy share one worker. Separate queues when
   actual generation begins to block CAD; no worker-count increase is needed for
   the present private local workflow.

Low-cost UX follow-ups worth considering are search in the scene tree for larger
projects and camera framing of just the selected part. Mesh repair, joint mesh/CAD
export, autosave conflict resolution and slicer integration are larger features.

## Repeat locally

Use Node 22+ in `apps/web`:

```bash
npm test
npm run build
npm run preview -- --port 18181 --strictPort
# In another terminal:
FORMA_TEST_URL=http://127.0.0.1:18181 npm run test:e2e -- performance-ux.spec.ts
FORMA_TEST_URL=http://127.0.0.1:18181 node scripts/measure-idle.mjs
```

Set `FORMA_CHROMIUM_PATH` if using an existing compatible Chromium installation.
Stop the preview afterward. To use the changed code in Compose at the next
intentional startup, rebuild the web image (`docker compose up --build -d`).
