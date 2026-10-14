# API contract v0.1

Same-origin base: `/api`. FastAPI also serves its interactive reference at `/docs` when accessed directly on API port 8000 during development. The Caddy frontend only proxies `/api`; use the source schemas or direct dev API for the reference.

| Method / path | Purpose |
|---|---|
| `GET /health` | Actual configured capabilities; no secret values |
| `GET /catalog` | Current component definitions |
| `GET /demo` | Example PICO project |
| `POST /validate` | Validate project schema and constraints |
| `POST /commands` | Apply a validated operation batch to a supplied document; no implicit save |
| `POST /chat` | Produce a plan against a supplied revision; no implicit save |
| `GET /projects` | List current user's local workspace projects |
| `POST /projects` | Create project, returned persisted `version=1` |
| `GET /projects/{id}` | `{project, version}` |
| `PUT /projects/{id}` | `{project, base_version}`; optimistic save or HTTP 409 |
| `GET /projects/{id}/revisions` | Persisted version metadata |
| `GET /projects/{id}/revisions/{version}` | Historical document |
| `POST /assets` | Multipart file upload (STL/GLB/images) |
| `GET /assets/{id}` | Metadata and same-origin URL |
| `GET /assets/{id}/content` | File bytes; add `?download=true` for attachment |
| `POST /jobs/preview` | `{project, part_id}` → job ID |
| `POST /jobs/export` | `{project, part_ids, format, layout, bed}` → job ID |
| `POST /jobs/meshy` | `{asset_id}` → charged generation job ID when configured |
| `GET /jobs/{id}` | Status, result/error and provider task ID if available |

Project schema is generated from Pydantic in `packages/schema/project.schema.json`. Template-specific geometric constraints are also enforced in the domain validators; the JSON Schema alone does not express all relationships.

`revision` is a local monotonically increasing editing counter used to reject outdated AI plans, including after undo. `version` is the server's persisted write counter. Keep these concepts separate. Save returns HTTP 409 on stale `base_version` and must not be retried by overwriting current data.

Jobs use immutable request snapshots. Export results contain asset metadata and `sliced: false`. Preview results contain triangles in local part coordinates plus bounds/volume. UI-only pose/explosion is never exported.

The current workspace has no account principal. All endpoints are private-local and must gain ownership filters before network exposure. API keys belong only to server configuration.
