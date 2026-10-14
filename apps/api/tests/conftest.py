import os
import tempfile
from pathlib import Path
import pytest

_folder = tempfile.TemporaryDirectory(prefix="forma-tests-")
os.environ["FORMA_DATABASE_URL"] = f"sqlite:///{Path(_folder.name) / 'test.db'}"
os.environ["FORMA_DATA_DIR"] = _folder.name
os.environ["FORMA_QUEUE"] = "inline"
os.environ["FORMA_STORAGE"] = "local"
os.environ["FORMA_OPENAI_API_KEY"] = ""
os.environ["FORMA_MESHY_API_KEY"] = ""
os.environ["FORMA_PUBLIC_URL"] = ""
os.environ["FORMA_AUTH_COOKIE_SECURE"] = "false"


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from forma.main import app

    from forma.owner import set_owner
    from forma.db import init_db
    init_db()
    set_owner("test-owner", "test-only-long-passphrase")
    with TestClient(app) as c:
        response = c.post("/api/auth/login", json={"username": "test-owner", "password": "test-only-long-passphrase"}, headers={"X-Forma-Request": "1"})
        assert response.status_code == 200
        c.headers.update({"X-Forma-Request": "1", "X-CSRF-Token": response.json()["csrf_token"]})
        yield c


@pytest.fixture
def anonymous_client():
    from fastapi.testclient import TestClient
    from forma.main import app
    from forma.owner import set_owner
    from forma.db import init_db
    init_db()
    set_owner("test-owner", "test-only-long-passphrase")
    with TestClient(app) as c:
        yield c
