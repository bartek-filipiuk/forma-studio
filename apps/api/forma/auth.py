"""Single-owner authentication. No public enrollment or client-stored bearer tokens."""
import hashlib
import secrets
from datetime import timedelta
from urllib.parse import urlsplit

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, text, update
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware

from .config import settings
from .db import AuthSessionRow, LoginLimitRow, OwnerRow, OWNER_ID, Session, utcnow

COOKIE = "forma_session"
hasher = PasswordHasher()
_dummy_hash = hasher.hash(secrets.token_urlsafe(32))
router = APIRouter(prefix="/api/auth", tags=["authentication"])


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def session_for(token):
    if not token or len(token) > 128:
        return None
    with Session() as db:
        row = db.scalar(select(AuthSessionRow).where(
            AuthSessionRow.token_hash == token_hash(token),
            AuthSessionRow.owner_id == OWNER_ID,
            AuthSessionRow.expires_at > utcnow(),
        ))
        owner = db.get(OwnerRow, OWNER_ID) if row else None
        return (row, owner.username) if owner else None


def same_origin(request):
    origin = request.headers.get("origin")
    expected = settings().public_url.rstrip("/") or str(request.base_url).rstrip("/")
    if origin and origin != expected:
        return False
    return request.headers.get("sec-fetch-site") != "cross-site"


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if not request.url.path.startswith("/api/"):
            return await call_next(request)
        public = request.url.path in {"/api/ready", "/api/auth/session", "/api/auth/login"}
        auth = await run_in_threadpool(session_for, request.cookies.get(COOKIE))
        request.state.auth = auth
        if not public and not auth:
            return JSONResponse({"detail": "Zaloguj się, aby otworzyć warsztat."}, status_code=401, headers={"Cache-Control": "no-store"})
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            # Custom headers cannot be sent by a cross-site HTML form. CORS is
            # intentionally not enabled; authenticated writes also bind to CSRF.
            if not same_origin(request) or request.headers.get("x-forma-request") != "1":
                return JSONResponse({"detail": "Odrzucono żądanie z innej strony."}, status_code=403)
            if not public and not secrets.compare_digest(request.headers.get("x-csrf-token", ""), auth[0].csrf_token):
                return JSONResponse({"detail": "Sesja formularza wygasła. Odśwież stronę."}, status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=1024)


def client_key(request):
    # Caddy overwrites X-Real-IP with the proxied client address; the API port
    # is not published, so only Caddy can set it. Direct dev runs use the peer.
    ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "")
    return f"ip:{ip[:61]}"


def limit_login(key):
    # ponytail: per-IP window, so a stranger cannot lock the owner out. A botnet
    # can try 10 passwords per IP; the 15+ character Argon2id passphrase covers it.
    now = utcnow()
    with Session.begin() as db:
        db.execute(delete(LoginLimitRow).where(LoginLimitRow.window_end <= now))
        db.execute(text("INSERT INTO login_limits (key, attempts, window_end) VALUES (:key, 0, :end) ON CONFLICT (key) DO NOTHING"), {"key": key, "end": now + timedelta(minutes=15)})
        allowed = db.execute(update(LoginLimitRow).where(LoginLimitRow.key == key, LoginLimitRow.attempts < 10).values(attempts=LoginLimitRow.attempts + 1)).rowcount
    if not allowed:
        raise HTTPException(429, "Zbyt wiele prób logowania. Spróbuj ponownie za 15 minut.", headers={"Retry-After": "900"})


@router.get("/session")
def current_session(request: Request):
    if request.state.auth:
        row, username = request.state.auth
        return {"authenticated": True, "username": username, "csrf_token": row.csrf_token}
    with Session() as db:
        configured = db.get(OwnerRow, OWNER_ID) is not None
    return {"authenticated": False, "configured": configured}


@router.post("/login")
def login(body: Login, request: Request, response: Response):
    key = client_key(request)
    limit_login(key)
    with Session() as db:
        owner = db.get(OwnerRow, OWNER_ID)
        password_hash = owner.password_hash if owner else _dummy_hash
    try:
        valid = hasher.verify(password_hash, body.password)
    except VerificationError:
        valid = False
    if not valid or not owner or not secrets.compare_digest(body.username.encode(), owner.username.encode()):
        raise HTTPException(401, "Nieprawidłowy login lub hasło.")
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    with Session.begin() as db:
        # Serializes against password resets; an old password must not create a
        # new session after the CLI has revoked existing sessions.
        current = db.scalar(select(OwnerRow).where(OwnerRow.id == OWNER_ID).with_for_update())
        if current.password_hash != password_hash:
            raise HTTPException(401, "Hasło zostało zmienione. Zaloguj się ponownie.")
        db.execute(delete(AuthSessionRow).where(AuthSessionRow.expires_at <= utcnow()))
        previous = request.cookies.get(COOKIE)
        if previous:
            db.execute(delete(AuthSessionRow).where(AuthSessionRow.token_hash == token_hash(previous)))
        db.add(AuthSessionRow(token_hash=token_hash(token), owner_id=OWNER_ID, csrf_token=csrf, expires_at=utcnow() + timedelta(hours=settings().session_hours)))
        db.execute(delete(LoginLimitRow).where(LoginLimitRow.key == key))
    secure = settings().auth_cookie_secure or urlsplit(settings().public_url).scheme == "https"
    response.set_cookie(COOKIE, token, max_age=settings().session_hours * 3600, httponly=True, secure=secure, samesite="lax", path="/api")
    return {"authenticated": True, "username": owner.username, "csrf_token": csrf}


@router.post("/logout")
def logout(request: Request, response: Response):
    with Session.begin() as db:
        db.execute(delete(AuthSessionRow).where(AuthSessionRow.token_hash == request.state.auth[0].token_hash))
    response.delete_cookie(COOKIE, path="/api")
    return {"authenticated": False}
