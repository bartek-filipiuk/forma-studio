# FORMA Studio — instructions for continuing implementation

Read `docs/CODEX_HANDOFF.md`, `docs/ARCHITECTURE.md` and `docs/VERIFICATION.md` before changing behavior. Communicate in Polish with Bartek; code identifiers in English.

## Product and constraints

- Build an enjoyable browser 3D workshop for designing physical objects, first a desktop AI robot and later figurines, toys, useful parts. The user wants a durable foundation and to continue locally in Codex CLI.
- Preserve React/TypeScript/Vite/Three/R3F, FastAPI/Pydantic, native CadQuery/Open CASCADE, PostgreSQL/Alembic, S3 and Celery/Redis. Keep local SQLite/disk convenience explicit; do not silently migrate user data.
- No replacement of the application with a static mockup or a mesh-only editor. Native CAD remains native and isolated from browser interactions.
- Treat mesh generation providers as replaceable adapters, not the project data model. Keep CAD and mesh sources distinct. Preserve original assets.
- No hidden fake AI, printer readiness, collision checks, time estimates, filament estimates, or successful generations. Missing keys return clear capability status.

## Domain rules

- Schema version 1, millimeters, Z-up. Local part origin: XY center, minimum Z=0. GLB uses meters before normalization to mm. Rotation degrees, extrinsic X then Y then Z; Three Euler order ZYX. Uniform scale only.
- `domain.py` is authoritative. Update client `domain.ts`, generated schemas and shared fixture when changing the contract. Add a document migration before bumping schema version.
- UI and chat must use the same validated operations. No eval or executable CAD generated directly from untrusted prompts. A failed operation batch must leave the project unchanged.
- Local `revision` invalidates stale AI plans; persisted server `version` guards concurrent saves. Undo/redo must increase local revision.
- `fit_to` currently propagates dimensions only, with acyclic references; deleting the reference freezes resolved dimensions. It is not an assembly constraint solver.
- Never include reference electronics in printable exports. Imported mesh is not editable parametric CAD.

## Implementation and validation

- Use per-project data boundaries and IDs; when adding accounts, put ownership in all project, asset, job and revision queries before public exposure.
- Never place provider keys in VITE_* or client files. `.env` is ignored. Paid provider POSTs are never automatically retried.
- Record provider model/version/task ID and persist the final asset on our storage.
- CAD/native tasks run in the worker. Local inline mode is only for development. Split CAD and long-running generation queues when needed.
- Preserve Alembic history. PostgreSQL schema is not created with `create_all` on production startup.
- Validate actual exports, not only screenshots. Bambu-profile 3MF and sliced G-code are separate capabilities from generic geometry 3MF.
- Existing test commands: `cd apps/api && uv run pytest -q`; `cd apps/web && npm test && npm run build`.
- Regenerate contract files from repo root with `apps/api/.venv/bin/python scripts/generate_schema.py` and sample exports with `apps/api/.venv/bin/python scripts/export_samples.py`.
- Run the browser/Docker acceptance scenario first; it could not be run in the handoff environment. Record evidence honestly in `docs/VERIFICATION.md`.

## Scope

This is currently one private local user. `compose.yaml` binds only localhost. Do not expose publicly without implementing access controls. Do not add billing or Kubernetes before the core physical workflow works.

Do not automatically send a job to the physical printer. Export and slicer preview are the current boundary.
