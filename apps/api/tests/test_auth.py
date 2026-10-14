from datetime import timedelta
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from forma.main import app
from forma.auth import COOKIE, token_hash
from forma.db import AuthSessionRow, AssetRow, JobRow, OwnerRow, ProjectRow, RevisionRow, OWNER_ID, Session, utcnow
from forma.owner import set_owner
from forma.domain import pico_project


def login(client, **headers):
    return client.post('/api/auth/login', json={'username': 'test-owner', 'password': 'test-only-long-passphrase'}, headers={'X-Forma-Request': '1', **headers})


@pytest.mark.parametrize('method,path', [
    ('GET', '/api/projects'), ('GET', '/api/projects/example'),
    ('GET', '/api/projects/example/revisions'), ('GET', '/api/projects/example/revisions/1'),
    ('GET', '/api/assets/example'), ('GET', '/api/assets/example/content'),
    ('GET', '/api/jobs/example'), ('GET', '/api/health'),
    ('POST', '/api/projects'), ('POST', '/api/chat'), ('POST', '/api/assets'),
    ('POST', '/api/jobs/preview'), ('POST', '/api/jobs/export'), ('POST', '/api/jobs/meshy'),
])
def test_anonymous_access_denied(anonymous_client, method, path):
    response = anonymous_client.request(method, path)
    assert response.status_code == 401
    assert response.headers['cache-control'] == 'no-store'


def test_login_cookie_csrf_logout_and_revocation(anonymous_client):
    c = anonymous_client
    assert c.get('/api/ready').json() == {'status': 'ok'}
    assert c.get('/api/auth/session').json() == {'authenticated': False, 'configured': True}
    response = login(c)
    assert response.status_code == 200
    cookie = response.headers['set-cookie']
    assert 'HttpOnly' in cookie and 'SameSite=lax' in cookie and 'Path=/api' in cookie
    token = c.cookies.get(COOKIE)
    with Session() as db:
        assert db.get(AuthSessionRow, token) is None
        assert db.get(AuthSessionRow, token_hash(token))
        assert db.get(OwnerRow, OWNER_ID).password_hash.startswith('$argon2id$')
    assert c.get('/api/projects').status_code == 200
    assert c.post('/api/auth/logout', headers={'X-Forma-Request': '1'}).status_code == 403
    headers = {'X-Forma-Request': '1', 'X-CSRF-Token': response.json()['csrf_token']}
    assert c.post('/api/auth/logout', headers={**headers, 'Origin': 'https://evil.invalid'}).status_code == 403
    assert c.post('/api/auth/logout', headers=headers).status_code == 200
    assert c.get('/api/projects').status_code == 401
    c.cookies.set(COOKIE, token)
    assert c.get('/api/projects').status_code == 401


def test_expiration_reset_and_login_rotation(anonymous_client):
    c = anonymous_client
    assert login(c).status_code == 200
    first = c.cookies.get(COOKIE)
    assert login(c).status_code == 200
    with Session() as db:
        assert db.get(AuthSessionRow, token_hash(first)) is None
    with Session.begin() as db:
        db.execute(update(AuthSessionRow).values(expires_at=utcnow() - timedelta(seconds=1)))
    assert c.get('/api/projects').status_code == 401
    assert login(c).status_code == 200
    set_owner('test-owner', 'a-different-long-passphrase')
    assert c.get('/api/projects').status_code == 401
    assert login(c).status_code == 401


def test_login_requires_same_origin_custom_header(anonymous_client):
    c = anonymous_client
    assert login(c, Origin='https://evil.invalid').status_code == 403
    assert login(c, **{'Sec-Fetch-Site': 'cross-site'}).status_code == 403
    assert c.post('/api/auth/login', json={'username': 'test-owner', 'password': 'test-only-long-passphrase'}).status_code == 403


def test_limit_survives_new_client_and_does_not_disclose_username(anonymous_client):
    c = anonymous_client
    for i in range(10):
        result = c.post('/api/auth/login', json={'username': 'test-owner' if i % 2 else 'unknown', 'password': 'wrong'}, headers={'X-Forma-Request': '1'})
        assert result.status_code == 401
        assert result.json()['detail'] == 'Nieprawidłowy login lub hasło.'
    with TestClient(app) as another:
        result = login(another)
        assert result.status_code == 429
        assert result.headers['retry-after'] == '900'


def test_limit_is_per_client_so_strangers_cannot_lock_out_owner(anonymous_client):
    c = anonymous_client
    for _ in range(10):
        c.post('/api/auth/login', json={'username': 'test-owner', 'password': 'wrong'}, headers={'X-Forma-Request': '1', 'X-Real-IP': '203.0.113.7'})
    assert login(c, **{'X-Real-IP': '203.0.113.7'}).status_code == 429
    assert login(c, **{'X-Real-IP': '198.51.100.2'}).status_code == 200


def test_unconfigured_installation_stays_locked(anonymous_client):
    from sqlalchemy import delete
    with Session.begin() as db:
        db.execute(delete(OwnerRow))
    assert anonymous_client.get('/api/auth/session').json()['configured'] is False
    assert login(anonymous_client).status_code == 401
    assert anonymous_client.get('/api/projects').status_code == 401


def test_owner_filters_all_resource_types(client):
    doc = pico_project().model_dump(mode='json')
    doc['id'] = 'foreign-project'
    with Session.begin() as db:
        db.add(ProjectRow(id=doc['id'], name='Foreign', revision=1, document=doc, owner_id='foreign'))
        db.add(RevisionRow(project_id=doc['id'], revision=1, document=doc, owner_id='foreign'))
        db.add(AssetRow(id='foreign-asset', name='foreign.stl', key='missing', mime='model/stl', size=1, metadata_json={}, owner_id='foreign'))
        db.add(JobRow(id='foreign-job', kind='preview', payload={}, owner_id='foreign'))
    assert all(p['id'] != doc['id'] for p in client.get('/api/projects').json())
    for path in [f"/api/projects/{doc['id']}", f"/api/projects/{doc['id']}/revisions/1", '/api/assets/foreign-asset', '/api/assets/foreign-asset/content', '/api/jobs/foreign-job']:
        assert client.get(path).status_code == 404
    assert client.get(f"/api/projects/{doc['id']}/revisions").json() == []
    assert client.put(f"/api/projects/{doc['id']}", json={'base_version': 1, 'project': doc}).status_code == 409
    doc['id'] = 'another-project'
    doc['parts'][0]['asset_id'] = 'foreign-asset'
    assert client.post('/api/projects', json=doc).status_code == 422


def test_https_public_origin_enables_secure_cookie(anonymous_client, monkeypatch):
    from forma.config import settings
    monkeypatch.setattr(settings(), 'public_url', 'https://forma.example.com')
    result = login(anonymous_client, Origin='https://forma.example.com')
    assert result.status_code == 200
    assert '; Secure' in result.headers['set-cookie']
    assert login(anonymous_client, Origin='http://forma.example.com').status_code == 403
