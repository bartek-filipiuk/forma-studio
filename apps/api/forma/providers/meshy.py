"""Replaceable image-to-mesh adapter. No automatic retries of paid POST calls."""

from __future__ import annotations
import base64
import time
from typing import Callable, Protocol
from urllib.parse import urlparse
import httpx
from ..config import settings


class MeshProvider(Protocol):
    def generate(
        self, content: bytes, mime: str, checkpoint: Callable[[str], None]
    ) -> tuple[bytes, dict]: ...


class MeshyProvider:
    def generate(self, content: bytes, mime: str, checkpoint: Callable[[str], None]):
        s = settings()
        if not s.meshy_api_key:
            raise ValueError("Brak FORMA_MESHY_API_KEY")
        headers = {"Authorization": f"Bearer {s.meshy_api_key}"}
        base = "https://api.meshy.ai/openapi/v1/image-to-3d"
        image = f"data:{mime};base64,{base64.b64encode(content).decode()}"
        with httpx.Client(timeout=120) as client:
            response = client.post(
                base,
                headers=headers,
                json={
                    "image_url": image,
                    "ai_model": s.meshy_model,
                    "should_texture": True,
                },
            )
            if not response.is_success:
                raise ValueError(
                    f"Meshy: HTTP {response.status_code}. Sprawdź klucz, plan i dostępność modelu."
                )
            task_id = response.json()["result"]
            checkpoint(task_id)
            deadline = time.monotonic() + 900
            while time.monotonic() < deadline:
                response = client.get(f"{base}/{task_id}", headers=headers)
                response.raise_for_status()
                task = response.json()
                if task.get("status") == "SUCCEEDED":
                    url = task.get("model_urls", {}).get("glb")
                    if not url or urlparse(url).scheme != "https":
                        raise ValueError("Meshy nie zwróciło bezpiecznego adresu GLB")
                    # URL is returned by the fixed provider endpoint, never accepted from a user.
                    with client.stream("GET", url) as stream:
                        stream.raise_for_status()
                        result = bytearray()
                        for chunk in stream.iter_bytes():
                            result.extend(chunk)
                            if len(result) > 150 * 1024 * 1024:
                                raise ValueError("Wynik Meshy przekracza limit 150 MB")
                    return bytes(result), {
                        "provider": "meshy",
                        "model": s.meshy_model,
                        "task_id": task_id,
                        "units": "meters",
                        "source": "image-to-3d",
                    }
                if task.get("status") in ("FAILED", "CANCELED"):
                    raise ValueError(
                        "Meshy nie wygenerowało modelu. Identyfikator zadania zachowano."
                    )
                time.sleep(3)
        raise ValueError(
            "Przekroczono 15 minut oczekiwania. Nie ponawiaj płatnej generacji automatycznie; sprawdź zapisany identyfikator Meshy."
        )
