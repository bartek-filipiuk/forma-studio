from pathlib import Path
from uuid import uuid4
from .config import settings
from .db import AssetRow, Session, owned


class StorageFullError(ValueError):
    def __init__(self):
        super().__init__("Brak wolnego miejsca w magazynie plików. Zwolnij miejsce na dysku serwera i ponów import lub eksport.")


def client():
    import boto3

    s = settings()
    return boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint,
        aws_access_key_id=s.s3_access_key,
        aws_secret_access_key=s.s3_secret_key,
        region_name="us-east-1",
    )


def put(name: str, content: bytes, mime: str, metadata: dict | None = None) -> dict:
    s = settings()
    asset_id = str(uuid4())
    name = Path(name).name[:150]
    suffix = Path(name).suffix.lower()
    key = f"assets/{asset_id}{suffix}"
    if s.storage == "s3":
        from botocore.exceptions import ClientError

        try:
            client().put_object(Bucket=s.s3_bucket, Key=key, Body=content, ContentType=mime)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("XMinioStorageFull", "InsufficientStorage"):
                raise StorageFullError() from exc
            raise
    else:
        target = Path(s.data_dir) / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    with Session.begin() as db:
        db.add(
            AssetRow(
                id=asset_id,
                name=name,
                key=key,
                mime=mime,
                size=len(content),
                metadata_json=metadata or {},
            )
        )
    return {
        "id": asset_id,
        "name": name,
        "url": f"/api/assets/{asset_id}/content",
        "mime": mime,
        "size": len(content),
        "metadata": metadata or {},
    }


def get(asset_id: str):
    with Session() as db:
        row = owned(db, AssetRow, asset_id)
        if not row:
            raise FileNotFoundError(asset_id)
        if settings().storage == "s3":
            content = (
                client()
                .get_object(Bucket=settings().s3_bucket, Key=row.key)["Body"]
                .read()
            )
        else:
            content = (Path(settings().data_dir) / row.key).read_bytes()
        return content, row.name, row.mime


def info(asset_id: str):
    with Session() as db:
        row = owned(db, AssetRow, asset_id)
        if not row:
            raise FileNotFoundError(asset_id)
        return {
            "id": row.id,
            "name": row.name,
            "url": f"/api/assets/{row.id}/content",
            "mime": row.mime,
            "size": row.size,
            "metadata": row.metadata_json,
        }
