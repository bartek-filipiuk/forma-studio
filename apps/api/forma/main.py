from __future__ import annotations
import json
import struct
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from uuid import uuid4
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from .config import settings
from .db import AssetRow, JobRow, ProjectRow, RevisionRow, Session, init_db, utcnow, OWNER_ID, owned
from .domain import CATALOG, Model, Operation, Project, apply_operations, pico_project
from .jobs import execute, run_job
from . import storage
from .providers.chat import plan


@asynccontextmanager
async def lifespan(app):
    init_db()
    yield


app = FastAPI(title="FORMA Studio API", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
from .auth import AuthMiddleware, router as auth_router
app.add_middleware(AuthMiddleware)
app.include_router(auth_router)


@app.exception_handler(ValueError)
async def invalid(request, exc):
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=507 if isinstance(exc, storage.StorageFullError) else 422,
        content={"detail": str(exc)[:600]},
    )


@app.get("/api/ready")
def ready():
    return {"status": "ok"}


@app.get("/api/health")
def health():
    s = settings()
    return {
        "status": "ok",
        "version": "0.1.0",
        "chat": "openai" if s.openai_api_key and s.openai_model else "local",
        "meshy": bool(s.meshy_api_key),
        "queue": s.queue,
        "slicing": False,
    }


@app.get("/api/catalog")
def catalog():
    return CATALOG


@app.get("/api/demo")
def demo():
    return pico_project()


def verify_assets(project):
    with Session() as db:
        for part in project.parts:
            if part.asset_id and not owned(db, AssetRow, part.asset_id):
                raise ValueError(
                    f"Brakuje pliku dla części: {part.name}. Zaimportuj go ponownie."
                )


@app.get("/api/projects")
def projects():
    with Session() as db:
        return [
            {
                "id": p.id,
                "name": p.name,
                "version": p.revision,
                "updated_at": p.updated_at,
            }
            for p in db.scalars(
                select(ProjectRow).where(ProjectRow.owner_id == OWNER_ID).order_by(ProjectRow.updated_at.desc()).limit(100)
            )
        ]


@app.post("/api/projects", status_code=201)
def create(project: Project):
    verify_assets(project)
    with Session.begin() as db:
        if owned(db, ProjectRow, project.id):
            raise HTTPException(409, "Projekt już istnieje. Wczytaj go przed zapisem.")
        document = project.model_dump(mode="json")
        db.add(
            ProjectRow(id=project.id, name=project.name, revision=1, document=document)
        )
        db.add(RevisionRow(project_id=project.id, revision=1, document=document))
        try:
            db.flush()
        except IntegrityError:
            raise HTTPException(409, "Projekt został już zapisany w innej karcie")
    return {"project": project, "version": 1}


@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    with Session() as db:
        row = owned(db, ProjectRow, project_id)
        if not row:
            raise HTTPException(404, "Nie znaleziono projektu")
        return {"project": row.document, "version": row.revision}


class Save(Model):
    base_version: int = Field(ge=1)
    project: Project


@app.put("/api/projects/{project_id}")
def save(project_id: str, body: Save):
    if body.project.id != project_id:
        raise ValueError("Id projektu nie pasuje do adresu")
    verify_assets(body.project)
    version = body.base_version + 1
    document = body.project.model_dump(mode="json")
    with Session.begin() as db:
        count = db.execute(
            update(ProjectRow)
            .where(
                ProjectRow.id == project_id, ProjectRow.owner_id == OWNER_ID, ProjectRow.revision == body.base_version
            )
            .values(
                name=body.project.name,
                document=document,
                revision=version,
                updated_at=utcnow(),
            )
        ).rowcount
        if count != 1:
            raise HTTPException(
                409,
                "Projekt zmienił się w innej karcie. Pobierz lokalny JSON przed wczytaniem aktualnej wersji.",
            )
        db.add(RevisionRow(project_id=project_id, revision=version, document=document))
    return {"project": body.project, "version": version}


@app.get("/api/projects/{project_id}/revisions")
def revisions(project_id: str):
    with Session() as db:
        return [
            {"version": r.revision, "created_at": r.created_at}
            for r in db.scalars(
                select(RevisionRow)
                .where(RevisionRow.project_id == project_id, RevisionRow.owner_id == OWNER_ID)
                .order_by(RevisionRow.revision.desc())
                .limit(50)
            )
        ]


@app.get("/api/projects/{project_id}/revisions/{version}")
def revision(project_id: str, version: int):
    with Session() as db:
        row = db.scalar(
            select(RevisionRow).where(
                RevisionRow.project_id == project_id, RevisionRow.revision == version, RevisionRow.owner_id == OWNER_ID
            )
        )
        if not row:
            raise HTTPException(404, "Nie znaleziono wersji")
        return {"project": row.document, "version": row.revision}


@app.post("/api/validate")
def validate(project: Project):
    return {
        "valid": True,
        "parts": len(project.parts),
        "print_parts": sum(p.role == "print" for p in project.parts),
    }


class Commands(Model):
    project: Project
    operations: list[Operation] = Field(max_length=50)
    base_revision: int


@app.post("/api/commands")
def commands(body: Commands):
    if body.base_revision != body.project.revision:
        raise HTTPException(409, "Plan dotyczy nieaktualnej rewizji")
    return apply_operations(body.project, body.operations)


class Chat(Model):
    project: Project
    message: str = Field(min_length=1, max_length=2000)
    selected_id: str | None = None


@app.post("/api/chat")
async def chat(body: Chat):
    return await plan(body.project, body.message, body.selected_id)


@app.post("/api/assets", status_code=201)
async def upload(file: UploadFile = File(...)):
    suffix = Path(file.filename or "").suffix.lower()
    types = {
        ".stl": "model/stl",
        ".glb": "model/gltf-binary",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }
    if suffix not in types:
        raise HTTPException(415, "Obsługiwane pliki: STL, GLB, PNG, JPG, WEBP")
    limit = settings().max_upload_mb * 1024 * 1024
    data = bytearray()
    while chunk := await file.read(1024 * 1024):
        data.extend(chunk)
        if len(data) > limit:
            raise HTTPException(413, "Plik jest zbyt duży")
    if not data:
        raise ValueError("Pusty plik")
    if suffix == ".stl":
        from .mesh_validation import validate_stl

        validate_stl(data)
    if suffix == ".glb":
        if len(data) < 20 or data[:4] != b"glTF":
            raise ValueError("Nieprawidłowy nagłówek GLB")
        version, total, json_size, chunk_type = struct.unpack_from("<IIII", data, 4)
        if (
            version != 2
            or total != len(data)
            or chunk_type != 0x4E4F534A
            or 20 + json_size > len(data)
        ):
            raise ValueError("Nieprawidłowa struktura GLB 2.0")
        try:
            document = json.loads(data[20 : 20 + json_size])
        except Exception:
            raise ValueError("Nieprawidłowy opis sceny GLB")
        for item in document.get("buffers", []) + document.get("images", []):
            uri = item.get("uri", "")
            if uri and not uri.startswith("data:"):
                raise ValueError(
                    "GLB musi osadzać swoje zasoby. Zapisz plik bez zewnętrznych tekstur i buforów."
                )
        if set(document.get("extensionsRequired", [])) & {
            "KHR_draco_mesh_compression",
            "EXT_meshopt_compression",
            "KHR_texture_basisu",
        }:
            raise ValueError("Na razie zaimportuj GLB bez kompresji Draco/Meshopt/KTX2")
    if suffix in (".png", ".jpg", ".jpeg", ".webp"):
        import io
        from PIL import Image

        try:
            with Image.open(io.BytesIO(data)) as im:
                if im.width * im.height > 40_000_000:
                    raise ValueError("Obraz ma zbyt dużą rozdzielczość")
                im.verify()
        except Exception:
            raise ValueError("Nieprawidłowy plik obrazu")
    return storage.put(
        file.filename or "asset",
        bytes(data),
        types[suffix],
        {"units": "meters" if suffix == ".glb" else "mm"},
    )


@app.get("/api/assets/{asset_id}")
def asset_info(asset_id: str):
    try:
        return storage.info(asset_id)
    except FileNotFoundError:
        raise HTTPException(404, "Nie znaleziono pliku")


@app.get("/api/assets/{asset_id}/content")
def asset_content(asset_id: str, download: bool = False):
    try:
        content, name, mime = storage.get(asset_id)
    except FileNotFoundError:
        raise HTTPException(404, "Nie znaleziono pliku")
    from urllib.parse import quote

    return Response(
        content,
        media_type=mime,
        headers={
            "Content-Disposition": f"{'attachment' if download else 'inline'}; filename*=UTF-8''{quote(name)}",
            "X-Content-Type-Options": "nosniff",
        },
    )


class PreviewJob(Model):
    project: Project
    part_id: str


class ExportJob(Model):
    project: Project
    part_ids: list[str] = Field(min_length=1, max_length=200)
    format: Literal["stl", "step", "3mf"]
    layout: Literal["plate", "assembly"] = "plate"
    bed: tuple[float, float, float] = (250, 250, 250)


def enqueue(kind, payload, background):
    job_id = str(uuid4())
    with Session.begin() as db:
        db.add(JobRow(id=job_id, kind=kind, payload=payload, status="queued"))
    if settings().queue == "celery":
        try:
            execute.delay(job_id)
        except Exception:
            with Session.begin() as db:
                row = owned(db, JobRow, job_id)
                row.status, row.error = (
                    "failed",
                    "Kolejka jest niedostępna. Sprawdź Redis i worker.",
                )
            raise HTTPException(503, "Kolejka jest niedostępna")
    else:
        background.add_task(run_job, job_id)
    return {"id": job_id, "status": "queued"}


@app.post("/api/jobs/preview", status_code=202)
def preview_job(body: PreviewJob, background: BackgroundTasks):
    part = next((p for p in body.project.parts if p.id == body.part_id), None)
    if not part or part.template == "mesh":
        raise ValueError("Wybierz część parametryczną")
    return enqueue("preview", body.model_dump(mode="json"), background)


@app.post("/api/jobs/export", status_code=202)
def export_job(body: ExportJob, background: BackgroundTasks):
    if any(x < 20 or x > 2000 for x in body.bed):
        raise ValueError("Wymiary płyty muszą mieścić się w zakresie 20–2000 mm")
    return enqueue("export", body.model_dump(mode="json"), background)


class MeshJob(Model):
    asset_id: str


@app.post("/api/jobs/meshy", status_code=202)
def meshy_job(body: MeshJob, background: BackgroundTasks):
    if not settings().meshy_api_key:
        raise HTTPException(
            503, "Meshy nie jest skonfigurowane. Dodaj klucz w .env backendu."
        )
    try:
        meta = storage.info(body.asset_id)
    except FileNotFoundError:
        raise HTTPException(404, "Nie znaleziono obrazu")
    if not meta["mime"].startswith("image/") or meta["size"] > 10 * 1024 * 1024:
        raise ValueError("Wybierz obraz do 10 MB")
    return enqueue("meshy", body.model_dump(mode="json"), background)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    with Session() as db:
        row = owned(db, JobRow, job_id)
        if not row:
            raise HTTPException(404, "Nie znaleziono zadania")
        return {
            "id": row.id,
            "kind": row.kind,
            "status": row.status,
            "result": row.result,
            "error": row.error,
            "provider_task_id": row.payload.get("provider_task_id"),
        }
