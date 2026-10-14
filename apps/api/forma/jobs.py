import logging
import threading
from celery import Celery
from sqlalchemy import update
from .config import settings
from .db import JobRow, Session, OWNER_ID, owned
from .domain import Project
from . import storage

log = logging.getLogger(__name__)
celery = Celery("forma", broker=settings().redis_url)
celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    worker_prefetch_multiplier=1,
    task_soft_time_limit=1100,
    task_time_limit=1200,
)
cad_lock = threading.Lock()


def run_job(job_id: str):
    with Session.begin() as db:
        claimed = db.execute(
            update(JobRow)
            .where(JobRow.id == job_id, JobRow.owner_id == OWNER_ID, JobRow.status == "queued")
            .values(status="running")
        )
        if claimed.rowcount != 1:
            return
        job = owned(db, JobRow, job_id)
        kind, payload = job.kind, job.payload
    try:
        if kind in ("preview", "export"):
            from . import cad

            project = Project.model_validate(payload["project"])
            with cad_lock:
                if kind == "preview":
                    part = next(p for p in project.parts if p.id == payload["part_id"])
                    result = cad.preview(project, part)
                else:
                    content = cad.export_project(
                        project,
                        payload["part_ids"],
                        payload["format"],
                        payload["layout"],
                        tuple(payload["bed"]),
                    )
                    result = storage.put(
                        f"forma-{project.id}.{payload['format']}",
                        content,
                        "application/octet-stream",
                        {
                            "project_revision": project.revision,
                            "format": payload["format"],
                            "sliced": False,
                        },
                    )
        elif kind == "meshy":
            from .providers.meshy import MeshyProvider

            content, _, mime = storage.get(payload["asset_id"])

            def checkpoint(task_id):
                with Session.begin() as db:
                    row = owned(db, JobRow, job_id)
                    row.payload = {**row.payload, "provider_task_id": task_id}

            content, metadata = MeshyProvider().generate(content, mime, checkpoint)
            result = storage.put(
                "meshy-model.glb", content, "model/gltf-binary", metadata
            )
        else:
            raise ValueError("Nieznany typ zadania")
        with Session.begin() as db:
            row = owned(db, JobRow, job_id)
            row.status, row.result = "succeeded", result
    except Exception as exc:
        log.exception("Job %s failed", job_id)
        # Do not return provider URLs, keys or arbitrary exception payloads to the UI.
        message = (
            str(exc)[:450]
            if isinstance(exc, ValueError)
            else "Nie udało się wykonać zadania. Szczegóły znajdują się w logach backendu."
        )
        with Session.begin() as db:
            row = owned(db, JobRow, job_id)
            row.status, row.error = "failed", message


@celery.task(name="forma.run_job")
def execute(job_id: str):
    run_job(job_id)
