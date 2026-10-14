from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="FORMA_", env_file=ROOT / ".env", extra="ignore"
    )
    database_url: str = f"sqlite:///{ROOT / 'data' / 'forma.db'}"
    redis_url: str = "redis://redis:6379/0"
    queue: str = "inline"  # Docker sets celery; inline is for local development only.
    storage: str = "local"
    data_dir: str = str(ROOT / "data")
    s3_endpoint: str = "http://minio:9000"
    s3_bucket: str = "forma"
    s3_access_key: str = "forma-local"
    s3_secret_key: str = "forma-local-development"
    openai_api_key: str = ""
    openai_model: str = ""
    meshy_api_key: str = ""
    meshy_model: str = "meshy-7.1"
    max_upload_mb: int = 40
    public_url: str = ""
    auth_cookie_secure: bool = False  # Enable for HTTPS outside localhost.
    session_hours: int = 12


@lru_cache
def settings() -> Settings:
    return Settings()
