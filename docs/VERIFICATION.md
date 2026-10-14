# Verification record

Prepared 2026-10-13/14. This record distinguishes executed checks from work still requiring the user's local environment.

## Executed

| Check | Result |
|---|---|
| TypeScript checking + Vite production build | Passed |
| Locked Python dependency resolution | `uv lock --check` passed |
| Initial Alembic migration | Fresh SQLite migration completed and column definitions matched ORM metadata |
| Compose configuration | YAML and shared service configuration parsed; no runtime claim |
| Frontend domain tests | 5 passed |
| Python backend/domain/CAD/API tests | 22 passed |
| Native CadQuery generation of all PICO scene primitives | All valid; each has a single positive-volume solid |
| STL and STEP sample export | Generated; STEP reimport preserves base volume |
| Standard 3MF structure | XML, units, object count, indices, plate bounds and shared closed mesh topology checked |
| Optimistic save conflict | Stale save returns 409 and leaves the newer document intact |
| Local command parser through API and common executor | Parameter mutation verified; stale revision rejected |
| Export job through FastAPI/TestClient | Real CAD job creates downloadable 3MF asset |
| Missing paid-provider credentials | Explicit capability status; no fabricated output |
| Linked dimensions | Propagation, cycle/missing-link rejection, freeze on reference deletion |
| Invalid operation batch | Atomic rejection in both Python and TypeScript |
| Undo/redo | Restores geometry and monotonically increases editing revision |

Generated artifacts are in `samples/exports`. Tests use disposable SQLite/local storage and inline job execution; they do not establish Postgres/S3/Celery deployment behavior.

## Original handoff limitations (superseded below)

- Docker Compose build/start, Postgres migration on a running Postgres server, MinIO integration and live Celery/Redis processing: Docker was unavailable in the preparation environment.
- Interactive browser/WebGL QA: no supported local browser-control capability was available. Production compilation and domain tests do not verify visible layout or manipulator behavior.
- Live OpenAI/Meshy calls: no keys were configured and no paid generations were run.
- Bambu Studio import/slicing, AMS assignments, printer profile compatibility or actual print/assembly: not available in this environment.

## Immediate CLI acceptance

1. Launch Compose and inspect `migrate`, API, worker, Postgres, Redis and MinIO status.
2. Open localhost:8080 on a WebGL-capable desktop browser.
3. Test dimensions, keyboard shortcuts, move/rotate, transparency, visibility, linked enclosure creation, chat and undo.
4. Save, reload, reopen from project list, then try two-tab conflicting saves.
5. Import one real STL and one embedded uncompressed GLB; check mm/m conversion and download original.
6. Rebuild a selected CAD part, export STL/STEP/3MF and inspect them in the intended tools.
7. Open the 3MF in Bambu Studio with the actual machine/nozzle/filament profile; verify dimensions and sliced layers.
8. Print a small fit coupon before treating the PICO assembly as physically validated.

## Known capability boundaries

- CAD templates are a deliberately small first set. No free sketcher, constraint solver or arbitrary boolean-operation UI yet.
- Imported meshes render and retain sources; they are not included in the current parametric CAD export. Download the original mesh for the slicer until that pipeline is added.
- Generic 3MF is unsliced. Colors are visual base materials, not validated AMS/extruder assignments.
- PICO dimensions derive from a beta envelope reference. Mounting hardware and joints are incomplete in this new exploration scene.
- The exact-CAD preview is explicit, not continuously recomputed while dragging. Immediate browser geometry is a fast approximation.
- One worker handles CAD and Meshy sequentially. Split queues if a long generation blocks interactive CAD work.
- Crashed running jobs need operator reconciliation; paid generations must not be blindly replayed.
- JSON export does not bundle assets. Full workspace portability needs database + assets or a future bundled project format.


## Linux acceptance — 2026-10-14

The browser workflow now runs against the actual Compose deployment: Caddy,
FastAPI, PostgreSQL, MinIO/S3, Redis and a separate Celery worker. SQLite/inline
unit tests remain separate from this deployment evidence. The application is
bound to `127.0.0.1:18080` on this workstation because port 8080 was already used.
No physical printer was contacted.

### Environment and startup

- Docker Engine 28.5.1 and Compose v2.40.0. PostgreSQL migration `0001` confirmed
  by querying `alembic_version`; the migrate service exits successfully.
- PostgreSQL, Redis, MinIO and API health checks pass. Live preview and export
  jobs are received and completed by the Celery worker through Redis.
- Both Docker Hub and Quay refused the original MinIO image pull. The local
  `.env` explicitly selects the existing official MinIO image
  `minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`
  (release `2025-09-07T16-13-09Z`). This is a workstation-specific fallback;
  availability of this image from a fresh registry pull is not established.
  `FORMA_MINIO_IMAGE` allows a trusted pinned image to be selected explicitly.
- Native dependencies were installed from the Python lockfile in the image.
  Disabling uv's download cache in image layers avoids retaining duplicate CAD
  packages. Local frontend checks used Node 24.20.0; the web image uses Node 22.
- One export failed with `XMinioStorageFull` after image builds reduced free disk
  below MinIO's reserve. Removing 344 MB of obsolete cache from the first FORMA
  web build restored writes. Another 397.5 MB of superseded FORMA web build
  cache was removed after the final dependency build. No unrelated images,
  volumes or projects were removed. Keep free disk headroom: low space can block imports/exports while
  the API health endpoint still returns OK.

### Fixes

- Numeric fields cancel with Escape, reject invalid dimensions and do not create
  revisions when merely focused and blurred. Text fields synchronize after undo
  and restore their committed value after an empty edit.
- Keyboard save commits the active input before taking its snapshot. Cached
  saved revision survives reload; fresh browser workspaces get unique project IDs.
- STL upload checks ASCII/binary structure, nonempty triangle data and finite
  coordinates before creating an asset. Original accepted bytes remain intact.
  This does not test manifoldness, repair geometry or certify printability.
- Selecting an imported mesh no longer silently preselects other parts for CAD
  export. The dialog explicitly explains the limitation and links original files.
  Changing export settings clears the link to a previous result.
- Scene text labels no longer create nested React DOM roots. The previous Drei
  Html cleanup caused `removeChild` exceptions during import/selection changes.
  Labels still follow the same world-space coordinates and camera projection.
- Full S3 storage now produces an actionable error in failed export jobs and
  HTTP 507 on uploads, instead of a generic failure.

### Executed checks

- Backend/domain/CAD/API suite: **24 passed** in a disposable Compose container,
  with its existing isolated SQLite/local/inline test fixture. One upstream
  Starlette/httpx deprecation warning remains.
- Frontend domain suite: **5 passed**. TypeScript and production Vite builds pass.
- Final production Chromium/Playwright suite: **5 passed** in 1.7 minutes, with
  no uncaught page errors in the full import/export workflow. It exercises real
  UI interactions, local chat through the API,
  a CAD preview in Celery, durable save/reload/reopen, two-tab save conflicts,
  stale chat responses, invalid STL rejection, valid STL import, source-byte
  equality, import deletion/undo, modal keyboard isolation and actual downloads.
- The workflow sets the base wall to 3 mm in the inspector, then 3.5 mm through
  local chat. Preview is valid, with native volume **97,463.62370756 mm³**.
- Downloaded base 3MF: **110 × 92 × 52 mm**, 892 triangles, positive signed volume
  **97,455.03888874 mm³** (about **0.009%** below the native CAD volume).
- Downloaded plate 3MF: four separate printable objects, no reference electronics,
  millimeter units, Z=0 bottoms, all vertices inside the 250 mm working plate,
  finite coordinates, valid indices and oppositely paired edges in closed shells.
  ZIP integrity and expected package members also pass.

The final browser artifacts and geometry report are preserved in
`docs/verification/2026-10-14/`. They are generic, unsliced 3MF files and do not
contain a Bambu profile, AMS assignments or G-code.

### Repeat the checks

With Compose running and Node 22+:

```bash
cd apps/web
npm ci
npx playwright install chromium
FORMA_TEST_URL=http://127.0.0.1:18080 npm run test:e2e
```

`FORMA_CHROMIUM_PATH` can point to an already installed compatible Chromium.
The suite uses fresh project IDs and creates clearly named acceptance projects.
From the repository root, validate the actual downloaded files with:

```bash
python3 scripts/verify_browser_exports.py apps/web/test-results/workshop-live-chat-CAD-wor-924b8-mport-and-real-3MF-download
```

For UI development against Compose rather than local uvicorn:

```bash
cd apps/web
FORMA_API_TARGET=http://127.0.0.1:18080 npm run dev
```

### Still not verified

Bambu Studio import/slicing, printer/nozzle/material profiles, AMS mapping and
physical fit/printing remain untested: Bambu Studio is unavailable here. Paid
OpenAI and Meshy calls were not made; chat was explicitly in local-command mode.
GLB rendering, transform-gizmo dragging and the complete mobile workflow were
not part of this acceptance run. Existing unit checks do not substitute for them.

## Subsequent performance/UX review — 2026-10-14

See `PERFORMANCE_REVIEW.md` for the later, isolated frontend checks and measured
idle rendering changes. These checks were performed with Compose stopped at the
user's request; they do not claim another live backend acceptance run. Measurement
values are preserved in `verification/2026-10-14/performance/idle-comparison.json`.

## Owner-only authentication and public pages — 2026-10-14

Implemented public `/`, login `/login` and authenticated `/app`, with server-side
protection for projects, revisions, assets, CAD/provider jobs and capability
status. The deployment remains bound to localhost. No real owner credential was
created and the user's existing Compose workspace stayed stopped throughout.
See `AUTHENTICATION.md` for interactive setup and HTTPS configuration.

### Executed checks

- Backend suite: **44 passed** (including anonymous endpoint denial, CSRF, owner
  resource filtering, Argon2id storage, hashed/revocable sessions, expiration,
  password reset and persistent login throttling). An additional targeted Secure
  cookie/public-origin test passed, for **45 backend cases** in total. Existing
  Starlette/httpx and SQLite datetime-adapter deprecation warnings remain.
- Frontend domain suite: **5 passed**. TypeScript and production Docker builds for
  API and frontend passed. The public entry is approximately 261 KB uncompressed
  / 82 KB gzip; the roughly 1 MB editor chunk is not requested by the landing.
- **13 browser scenarios passed across runs**. The combined run was externally
  interrupted with exit 143 after 11 completed passes; the remaining stale-chat
  and full workshop scenarios then passed in a separate 29.5-second run. No claim
  of a single uninterrupted 13-test run is made.
- Auth checks use actual PostgreSQL-backed sessions: redirect from `/app`, wrong
  password, login, reload, logout/revocation and loss of a session while editing.
  Local recovery data survives, but the editor unmounts on unauthorized responses.
- The five performance-focused tests explicitly stub session/API boundaries;
  they verify WebGL/UI behavior, not real access control. The three auth tests and
  five workshop tests use the live disposable deployment.
- Full authenticated workflow: local chat, native CAD worker, optimistic saves,
  reload/reopen, STL import/source download and base/plate 3MF downloads all pass.
  Export geometry checks also pass: closed shells, expected dimensions and native
  volume agreement. No Bambu Studio or physical printing checks were performed.
- Alembic `0002` runs on the disposable PostgreSQL deployment. A separate upgrade
  test from populated `0001` SQLite preserves existing document JSON, assigns its
  owner and creates no default account or password.
- Desktop and 390 × 844 mobile public/login pages inspected without horizontal
  overflow. Page screenshots are preserved in
  `verification/2026-10-14/authentication/`. The public image is an actual render
  of the bundled PICO example, without private project data. UI detector: no findings.
- Caddy serves the intended same-origin CSP, anti-framing and cache headers.
  Anonymous direct `/api/projects` returns 401. No public domain/TLS deployment
  was performed; the HTTPS cookie behavior is covered by a configuration test.

All live acceptance used the separate `forma-auth-qa` Compose project on localhost
port 18182, with separate PostgreSQL/Redis/MinIO volumes, disabled paid providers
and a disposable credential. After artifact capture, only that QA stack and its
volumes were removed. The original `forma-studio` workspace and volumes remain
stopped and intact. At the next startup use `docker compose up --build -d` so old
stopped containers are recreated from the authenticated implementation, then run
`docker compose exec api python -m forma.owner` to set the real owner password.
