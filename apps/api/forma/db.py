from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import CheckConstraint, JSON, DateTime, Integer, String, UniqueConstraint, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from .config import settings


def utcnow():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


OWNER_ID = "owner"


class Owned:
    owner_id: Mapped[str] = mapped_column(String(64), default=OWNER_ID, server_default=OWNER_ID, index=True)


def owned(db, model, row_id):
    from sqlalchemy import select
    return db.scalar(select(model).where(model.id == row_id, model.owner_id == OWNER_ID))


class OwnerRow(Base):
    __tablename__ = "owner"
    __table_args__ = (CheckConstraint("id = 'owner'", name="single_owner"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=OWNER_ID)
    username: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(255))


class AuthSessionRow(Base):
    __tablename__ = "auth_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), default=OWNER_ID)
    csrf_token: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class LoginLimitRow(Base):
    __tablename__ = "login_limits"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    attempts: Mapped[int] = mapped_column(Integer)
    window_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ProjectRow(Owned, Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    revision: Mapped[int] = mapped_column(Integer, default=1)
    document: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class RevisionRow(Owned, Base):
    __tablename__ = "revisions"
    __table_args__ = (UniqueConstraint("project_id", "revision"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(String(64), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    document: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )


class AssetRow(Owned, Base):
    __tablename__ = "assets"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    key: Mapped[str] = mapped_column(String(250))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class JobRow(Owned, Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(24), default="queued")
    payload: Mapped[dict] = mapped_column(JSON)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )


Path(settings().data_dir).mkdir(parents=True, exist_ok=True)
kwargs = (
    {"connect_args": {"check_same_thread": False}}
    if settings().database_url.startswith("sqlite")
    else {}
)
engine = create_engine(settings().database_url, pool_pre_ping=True, **kwargs)
Session = sessionmaker(engine, expire_on_commit=False)


def init_db():
    # Production/Compose runs Alembic. Convenience only for local SQLite.
    if settings().database_url.startswith("sqlite"):
        Base.metadata.create_all(engine)
