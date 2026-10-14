from uuid import uuid4
from forma.domain import pico_project


def document():
    p = pico_project().model_dump(mode="json")
    p["id"] = str(uuid4())
    return p


def test_save_reload_and_optimistic_conflict(client):
    doc = document()
    first = client.post("/api/projects", json=doc)
    assert first.status_code == 201 and first.json()["version"] == 1
    doc["name"] = "Zapisana zmiana"
    doc["revision"] += 1
    assert (
        client.put(
            f"/api/projects/{doc['id']}", json={"base_version": 1, "project": doc}
        ).status_code
        == 200
    )
    doc["name"] = "Stara karta"
    assert (
        client.put(
            f"/api/projects/{doc['id']}", json={"base_version": 1, "project": doc}
        ).status_code
        == 409
    )
    loaded = client.get(f"/api/projects/{doc['id']}").json()
    assert loaded["project"]["name"] == "Zapisana zmiana"
    assert loaded["version"] == 2
    assert len(client.get(f"/api/projects/{doc['id']}/revisions").json()) == 2


def test_local_chat_and_shared_command_executor(client):
    doc = document()
    response = client.post(
        "/api/chat",
        json={
            "project": doc,
            "selected_id": "pico-base",
            "message": "Ustaw ściankę na 3 mm",
        },
    )
    assert response.status_code == 200
    plan = response.json()
    assert plan["provider"] == "local"
    changed = client.post(
        "/api/commands",
        json={
            "project": doc,
            "operations": plan["operations"],
            "base_revision": doc["revision"],
        },
    )
    assert changed.status_code == 200
    assert changed.json()["parts"][0]["params"]["wall"] == 3
    assert (
        client.post(
            "/api/commands",
            json={
                "project": doc,
                "operations": plan["operations"],
                "base_revision": 99,
            },
        ).status_code
        == 409
    )


def test_real_export_job_and_download(client):
    response = client.post(
        "/api/jobs/export",
        json={"project": document(), "part_ids": ["pico-base"], "format": "3mf"},
    )
    assert response.status_code == 202
    job = client.get(f"/api/jobs/{response.json()['id']}").json()
    assert job["status"] == "succeeded", job
    result = job["result"]
    content = client.get(result["url"])
    assert content.status_code == 200 and content.content[:2] == b"PK"
    assert result["metadata"]["sliced"] is False


def test_meshy_missing_key_is_explicit_and_never_simulated(client):
    result = client.post("/api/jobs/meshy", json={"asset_id": "missing"})
    assert result.status_code == 503
    assert client.get("/api/health").json()["meshy"] is False


def test_invalid_cad_never_creates_job(client):
    doc = document()
    doc["parts"][0]["params"]["wall"] = 90
    assert (
        client.post(
            "/api/jobs/export",
            json={"project": doc, "part_ids": ["pico-base"], "format": "stl"},
        ).status_code
        == 422
    )


def test_untrusted_imports_do_not_become_executable_content(client):
    assert (
        client.post(
            "/api/assets",
            files={"file": ("attack.html", b"<script>alert(1)</script>", "text/html")},
        ).status_code
        == 415
    )
    assert (
        client.post(
            "/api/assets",
            files={"file": ("bad.glb", b"not a GLB", "model/gltf-binary")},
        ).status_code
        == 422
    )


def test_missing_assets_block_save(client):
    doc = document()
    doc["parts"][0]["asset_id"] = "missing-file"
    assert client.post("/api/projects", json=doc).status_code == 422


def test_stl_upload_preserves_binary_and_ascii_sources_and_rejects_corruption(client):
    import struct

    triangle = (0, 0, 1, 0, 0, 0, 10, 0, 0, 0, 10, 0)
    binary = b"FORMA".ljust(80, b"\0") + struct.pack("<I12fH", 1, *triangle, 0)
    ascii_stl = b"solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid test\n"
    for data in (binary, ascii_stl):
        response = client.post("/api/assets", files={"file": ("valid.stl", data, "model/stl")})
        assert response.status_code == 201
        assert client.get(response.json()["url"]).content == data
    nan_triangle = list(triangle)
    nan_triangle[3] = float("nan")
    nonfinite = binary[:84] + struct.pack("<12fH", *nan_triangle, 0)
    for data in (b"not STL", b"solid empty\nendsolid empty", binary[:-1], nonfinite, ascii_stl.replace(b"10 0 0", b"NaN 0 0")):
        response = client.post("/api/assets", files={"file": ("broken.stl", data, "model/stl")})
        assert response.status_code == 422
        assert "STL" in response.json()["detail"]


def test_full_storage_is_actionable_for_uploads_and_export_jobs(client, monkeypatch):
    from forma import storage

    def full(*args, **kwargs):
        raise storage.StorageFullError()

    monkeypatch.setattr(storage, "put", full)
    data = b"solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid test\n"
    upload = client.post("/api/assets", files={"file": ("test.stl", data, "model/stl")})
    assert upload.status_code == 507
    assert "Zwolnij miejsce" in upload.json()["detail"]
    response = client.post("/api/jobs/export", json={"project": document(), "part_ids": ["pico-base"], "format": "3mf"})
    job = client.get(f"/api/jobs/{response.json()['id']}").json()
    assert job["status"] == "failed"
    assert "Zwolnij miejsce" in job["error"]
