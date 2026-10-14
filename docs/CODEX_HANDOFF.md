# Continuation brief for Codex CLI

Read `AGENTS.md` first. Communicate with Bartek in Polish.

## Accepted direction

We are building FORMA Studio (working name): an enjoyable, responsive browser editor for real 3D-printable objects. The primary personal project is a desktop robot mediating voice communication with agents on a VPS. A future path is a multi-user product, but it is not the current scaling target.

The user insists on a good long-lived foundation. Preserve the native CAD backend, versioned documents, independent mesh/CAD paths and interchangeable providers. Do not rebuild as an all-in-one hosted mockup or switch frameworks to simplify deployment.

The user accepted Meshy as initial image-to-3D service, with a self-hosted alternative later. TRELLIS.2 was researched as one candidate; official setup calls for 24 GB NVIDIA VRAM. No GPU purchase or model-training project was authorized. Hunyuan3D 2.1's published license excludes the EU; do not select it by default for the Polish user. Recheck current model/license details when implementing.

## Current implementation

- React/Three editor with seven-part PICO exploration scene and an eight-item template catalog.
- GUI and chat share domain operations, revision checks, undo/redo and validation.
- Parametric enclosures, screen shell, plate with holes, box and cylinder; editable dimensions.
- `fit_to` dimension dependencies for automatically sized enclosures.
- Native CAD proof/preview and real STL/STEP/3MF output in async jobs.
- API, durable project snapshots, Alembic migration, asset store (S3/local), Celery, Compose.
- Import STL/GLB; Meshy image-to-GLB adapter and image-upload UI; OpenAI edit planner via Responses.
- Clear local command mode without API credentials.
- Source includes examples, tests, schema, dependency locks, Dockerfiles, README and this handoff.

## Linux continuation update — 2026-10-14

The full Compose/browser acceptance has now been run. Read the Linux section in
`docs/VERIFICATION.md` and its preserved artifacts before repeating setup. The
workstation uses localhost:18080 and a cached, digest-pinned MinIO override.
Dimension cancellation, text undo, save status, STL validation, mesh export
messaging and scene-label cleanup were fixed without changing the document
schema or CAD/mesh/storage/worker boundaries. Bambu Studio and physical checks
are still outstanding.

## First actions in the CLI

1. Read `docs/VERIFICATION.md`. Start `docker compose up --build -d`; confirm migrations, bucket creation, health and worker processing. This environment had no Docker binary.
2. Use the available browser tooling to test the actual UI. This environment had no supported browser-control skill for local QA. Confirm renderer starts, controls use Z-up, head faces camera, manipulator updates actual position, dimensions commit on blur/Enter, undo/redo works, modal keyboard handling works, GLB renders in expected units.
3. End-to-end: edit base wall to 3 mm → chat changes it → verify CAD → save/reload → export selected base and full plate → open 3MF in Bambu Studio. Compare dimensions with the JSON and STEP.
4. Fix actual failures and record what you ran. Do not claim manual/browser/printer verification based solely on the unit suite.
5. Ask for API keys only through the user's normal local secret configuration when they want those integrations activated. Do not request secrets pasted into a chat; do not invent generated results.

## Prioritized next work

### 1. A physically useful PICO component

Choose one real component (e.g. the actual SG90 or CoreS3), confirm its measured geometry and add useful clearance-aware mounting geometry. Add a small printable fit coupon. Validate that GUI/chat changes propagate to actual CAD. Then refine the matching enclosure. The current PICO scene is a visualization/parametric exploration, not the original seven-part mechanical assembly.

Prior reference provided in the conversation: `PICO_CUTE_v1_instrukcja.pdf`, dated 2026-10-11. Head envelope 82 × 82 × 38 mm; base 110 × 92 × 52 mm; two SG90s; CoreS3 without DinBase; PCA9685 envelope 60 × 40 × 18 mm. The original was explicitly a beta without physical assembly validation. Its OpenSCAD/STL ZIP remains in the user's files; it is not included in this repo. Request/materialize that exact file if doing a faithful migration; do not reconstruct mounting dimensions from the PDF envelope alone.

### 2. Real attachment and assembly semantics

Introduce stable component definitions/versions, semantic anchors, parent/child transforms and an explicit joint model. Current `group` and visual PAN/TILT controls are a PICO-only preview. No collision detection, cable routing, tolerance solver or physics exists. Preserve existing project version 1 with a migration if the schema changes.

### 3. Import and mesh workflow

Add STEP import as a preserved B-rep asset (do not pretend it recovers feature history). Add mesh bounds/units editing, watertightness checks, repair as an explicit operation, printability checks, base/peg geometry and joint mesh/CAD export. Test with a real generated figurine. Store each result as an immutable asset with lineage. Add portable project bundles with assets; a JSON download alone is not a full backup.

### 4. Bambu-specific output

The user owns X2D + AMS, but no verified machine/profile/dyszzle/material bundle was provided. Confirm the actual installed Bambu Studio profile (including nozzle, plate, material) and capture a known-good small `.3mf` as a test fixture. Add a version-pinned slicer worker/adapter. Start by reproducing a verified profile-based project, then slice. Validate output, printer compatibility and preview. Do not auto-send jobs to hardware.

Generic current 3MF is intentionally unsliced. Its base materials do not guarantee AMS/extruder assignments. An arbitrary printer-brand default is not sufficient.

### 5. Image and generation workflow

Add OpenAI image concept generation/editing as its own provider, configured through environment variables. The user mentioned GPT Image 2.5, but recheck current exact model identifiers and supported API before implementation. Build image → mesh → dimensions/repair → CAD additions → printer export as explicit stages. Generated views need consistency; texture detail does not become physical relief automatically.

Benchmark Meshy against a self-hosted candidate on about 10 actual projects, measuring usable-result rate, cleanup effort and cost per printable result. Keep interfaces independent of vendor IDs. Do not train a foundation model from scratch for this personal app.

### 6. Operational growth only when needed

Split CAD and generation queues; add job heartbeat/reconciliation, orphan-asset collection, snapshot retention, database and S3 backup tooling. Owner-only authentication and ownership are now implemented; verify HTTPS/origin configuration before a separate deployment. Multiple accounts still require request-scoped ownership throughout the domain. Add spend limits and idempotency for charged jobs. Multi-user billing and Kubernetes are not current priorities.

## Implementation cautions

- No assistant/printer/GPU secrets exist in this package.
- Current UI is Polish; explanatory states must remain honest, especially around reference geometry and paid providers.
- New default models should be configuration, not baked into the document format.
- Existing data structures have one global catalog; do not mutate old templates in place after real users have saved projects. Introduce template versions before expanding the persistent catalog.
- Current source uses local-only storage as a development fallback; it does not auto-copy used SQLite files into PostgreSQL or local assets into S3.
- Keep source and tests focused. There are no tests that can establish physical fit; print and measure coupons.

## Performance/UX continuation — 2026-10-14

The user requested shutdown and a performance/UX review. Compose is stopped;
project volumes remain intact. See `docs/PERFORMANCE_REVIEW.md` for measured idle
rendering improvements, deferred import loaders, STL resource reuse, static-file
caching and small UX additions. Rebuild the web image on the next intentional
startup to pick up these changes. Backend architecture and schema are unchanged.

## Owner authentication continuation — 2026-10-14

The user chose owner-only access, without registration. Public `/`, `/login` and
protected `/app` now exist. Read `docs/AUTHENTICATION.md` before startup. Migration
`0002` preserves existing private data and adds ownership, sessions and login
throttling. Configure the real owner interactively with `python -m forma.owner` in
the API container; no default or real owner password was created by the agent.
The original Compose workspace remains stopped. Acceptance uses a disposable
Compose project, never the user's database. Public deployment/TLS is not performed.
