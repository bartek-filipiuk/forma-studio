# Owner-only access

FORMA has a public landing page at `/`, a login page at `/login` and the protected
workshop at `/app`. It supports exactly one owner, without public registration,
email recovery or a default password. An unconfigured installation remains locked.

## First setup or password reset

From the repository root:

```bash
docker compose up --build -d
docker compose exec api python -m forma.owner
```

Enter a login and a password/passphrase of at least 15 characters at the prompts.
The password is hidden while typing and is not passed as a command-line argument
or stored in `.env`. The same command resets the login/password and revokes all
existing sessions. Existing projects and files remain unchanged.

On this workstation the site is `http://localhost:18080`. Stop it afterward with
`docker compose stop` if desired. The implementation session leaves the actual
workspace stopped and does not configure the owner's real credential.

For explicit local Python/SQLite development, run migrations and
`uv run python -m forma.owner` inside `apps/api`, using the same database settings
as the API. This does not migrate PostgreSQL data to SQLite.

## Authentication boundary

- PostgreSQL stores the sole owner's Argon2id password hash. A database constraint
  prevents a second owner account; there is no enrollment API.
- Sessions use cryptographically random opaque cookies, with only SHA-256 token
  hashes stored server-side. Cookies are HttpOnly, SameSite=Lax and scoped to
  `/api`. Absolute lifetime defaults to 12 hours (`FORMA_SESSION_HOURS`). Login
  rotates the current browser's session; logout and password reset revoke it.
- State-changing requests require a custom same-origin header and a per-session
  CSRF token. Login also requires the custom header and validates Origin/fetch-site.
  The application does not enable cross-origin credentialed API access.
- Failed login attempts are limited to ten per fifteen-minute window for this
  installation, using atomic database updates. The limit survives API restarts
  and multiple API processes. Successful login or an owner reset clears it.
- Every API resource is authenticated except `/api/ready`, `/api/auth/session` and
  `/api/auth/login`. The readiness response contains only a status. API docs and
  OpenAPI endpoints are disabled. API responses use `Cache-Control: no-store`.
- Projects, revision snapshots, assets and jobs carry `owner_id`; resource queries
  and job claims filter for the sole owner. Alembic migration `0002` attributes
  existing private-workspace records to that owner without changing document JSON
  or deleting data. Adding multiple accounts later still needs a real user model
  and request-scoped ownership; changing the singleton constraint alone is not
  sufficient.
- Landing and login load without downloading the editor/Three bundle. The editor
  is mounted only after the server confirms a session. A 401 tears it down and
  asks for login. Logout reloads the login page and clears in-memory query state.

Local draft recovery in `localStorage` remains intentionally intact on logout or
session expiry. It is not encrypted. Web authentication protects server access;
it does not protect drafts from another person with access to the same browser
profile, OS account or developer tools. Use a separate trusted browser/OS profile.
The shipped public preview image depicts only the bundled PICO example.

## HTTPS and deployment

Compose still binds only localhost; no public deployment was performed. For an
HTTPS reverse proxy, configure the browser-facing origin and secure cookies:

```dotenv
FORMA_PUBLIC_URL=https://forma.example.com
FORMA_AUTH_COOKIE_SECURE=true
```

Recreate API/worker containers after configuration changes. `FORMA_PUBLIC_URL`
uses the scheme, hostname and optional port, without a path. With an HTTPS public
URL, session cookies are automatically Secure even if the explicit flag is absent.
Do not enable Secure cookies for plain HTTP localhost. Do not expose the API,
PostgreSQL, Redis or MinIO ports directly. The exact domain/TLS setup belongs to a
separate deployment task.

Caddy adds a same-origin CSP and disables framing. Static hashed build assets are
cacheable; authentication and API responses are not. Do not cache `/api/*` in a CDN.

## Verification

See the authentication section of `VERIFICATION.md`. Backend tests use disposable
SQLite and temporary files. The browser acceptance uses a separate Compose project,
PostgreSQL, S3 and Celery with a disposable owner; it does not set the real password.

To run authenticated workshop E2E checks against a disposable installation, set
`FORMA_TEST_URL`, `FORMA_TEST_USERNAME` and `FORMA_TEST_PASSWORD` in the test
process environment, then run `npm run test:e2e` in `apps/web`. Do not use real owner
credentials in retained browser traces. Performance-only tests explicitly stub the
session endpoint; they are not evidence of access-control enforcement.
