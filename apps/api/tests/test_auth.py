"""Authentication integration tests run against an isolated SQLite database and memory mail adapter."""
import re
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select

from tiny_city_api.config import Settings
from tiny_city_api.email_service import MemoryEmailSender
from tiny_city_api.main import create_app
from tiny_city_api.models import AuthSession, Base, OneTimeToken, User, UserCitySave
from tiny_city_api.security import session_cookie_name


ORIGIN = 'http://localhost:5173'
PASSWORD = 'Tiny city passphrase 2026!'


@pytest.fixture
def client():
    settings = Settings(app_env='test', database_url='sqlite:///:memory:', auth_email_backend='dev_sink',
        dev_email_sink_enabled=True, tiny_city_provider_mode='local')
    sender = MemoryEmailSender()
    app = create_app(settings=settings, email_sender=sender)
    Base.metadata.create_all(app.state.db_engine)
    with TestClient(app) as test_client:
        test_client.email_sender = sender
        test_client.db_engine = app.state.db_engine
        yield test_client
    app.state.db_engine.dispose()


def csrf(client: TestClient) -> dict[str, str]:
    response = client.get('/v1/auth/csrf')
    assert response.status_code == 200
    return {'Origin': ORIGIN, 'X-CSRF-Token': response.json()['csrfToken']}


def register_and_verify(client: TestClient, email: str = 'city@example.com') -> str:
    headers = csrf(client)
    response = client.post('/v1/auth/register', json={
        'display_name': 'Huy Hoang', 'email': email, 'password': PASSWORD,
    }, headers=headers)
    assert response.status_code == 202
    message = client.email_sender.messages[-1]
    token = re.search(r'#token=([^\s]+)', message.text)
    assert token
    response = client.post('/v1/auth/verify-email', json={'token': token.group(1)}, headers=csrf(client))
    assert response.status_code == 200
    return email


def sign_in(client: TestClient, email: str = 'city@example.com') -> dict:
    return client.post('/v1/auth/login', json={'email': email, 'password': PASSWORD}, headers=csrf(client))


def valid_snapshot(name='Villa Gardens'):
    return {
        'size': 64, 'funds': 1000, 'roads': [], 'buildings': [], 'saveVersion': 3,
        'simulation': {
            'schemaVersion': 2, 'id': 'world-1',
            'plan': {'id': 'plan-1', 'name': name, 'width': 64, 'height': 64, 'buildings': [], 'roads': [], 'blockedTiles': []},
            'clock': {'tick': 0}, 'budget': {'openingBalance': 1000, 'balance': 1000, 'totalSpent': 0},
            'randomState': 1, 'citizens': [], 'revision': 0, 'nextBuildingId': 1,
        },
    }


def test_register_requires_csrf_and_never_stores_plaintext_or_returns_verification_token(client):
    no_csrf = client.post('/v1/auth/register', json={'display_name': 'Huy', 'email': 'one@example.com', 'password': PASSWORD})
    assert no_csrf.status_code == 403
    response = client.post('/v1/auth/register', json={'display_name': 'Huy', 'email': 'one@example.com', 'password': PASSWORD}, headers=csrf(client))
    assert response.status_code == 202
    assert 'token' not in response.text.lower()
    with client.db_engine.connect() as connection:
        from sqlalchemy.orm import Session
        user = Session(bind=connection).scalar(select(User).where(User.normalized_email == 'one@example.com'))
        assert user and user.password_hash != PASSWORD
        assert user.password_hash.startswith('$argon2id$')
        assert '@' not in user.password_hash
    assert client.email_sender.messages[0].to == 'one@example.com'


def test_verification_is_one_time_and_unverified_login_is_rejected(client):
    response = client.post('/v1/auth/register', json={'display_name': 'Huy', 'email': 'pending@example.com', 'password': PASSWORD}, headers=csrf(client))
    assert response.status_code == 202
    token = re.search(r'#token=([^\s]+)', client.email_sender.messages[-1].text).group(1)
    assert sign_in(client, 'pending@example.com').status_code == 401
    verified = client.post('/v1/auth/verify-email', json={'token': token}, headers=csrf(client))
    assert verified.status_code == 200
    assert client.post('/v1/auth/verify-email', json={'token': token}, headers=csrf(client)).status_code == 400


def test_duplicate_email_normalization_and_token_expiry_are_enforced(client):
    first = client.post('/v1/auth/register', json={'display_name': 'Huy', 'email': 'Case@Example.com', 'password': PASSWORD}, headers=csrf(client))
    assert first.status_code == 202
    count = len(client.email_sender.messages)
    duplicate = client.post('/v1/auth/register', json={'display_name': 'Other', 'email': ' case@example.com ', 'password': PASSWORD}, headers=csrf(client))
    assert duplicate.status_code == 202
    assert len(client.email_sender.messages) == count
    token = re.search(r'#token=([^\s]+)', client.email_sender.messages[-1].text).group(1)
    with client.db_engine.begin() as connection:
        from sqlalchemy import update
        connection.execute(update(OneTimeToken).values(expires_at=datetime(2000, 1, 1)))
    expired = client.post('/v1/auth/verify-email', json={'token': token}, headers=csrf(client))
    assert expired.status_code == 400
    assert expired.json()['error']['code'] == 'INVALID_OR_EXPIRED_TOKEN'


def test_rate_limit_uses_shared_database_bucket(client):
    original_settings = client.app.state.settings
    client.app.state.settings = original_settings.model_copy(update={'auth_register_limit': 1})
    first = client.post('/v1/auth/register', json={'display_name': 'One', 'email': 'one@example.com', 'password': PASSWORD}, headers=csrf(client))
    assert first.status_code == 202
    second = client.post('/v1/auth/register', json={'display_name': 'Two', 'email': 'two@example.com', 'password': PASSWORD}, headers=csrf(client))
    assert second.status_code == 429
    assert second.json()['error']['code'] == 'RATE_LIMITED'


def test_forgot_password_is_generic_and_reset_token_cannot_be_reused(client):
    register_and_verify(client)
    unknown = client.post('/v1/auth/forgot-password', json={'email': 'unknown@example.com'}, headers=csrf(client))
    known = client.post('/v1/auth/forgot-password', json={'email': 'CITY@example.com'}, headers=csrf(client))
    assert unknown.status_code == known.status_code == 202
    assert unknown.json() == known.json()
    token = re.search(r'#token=([^\s]+)', client.email_sender.messages[-1].text).group(1)
    reset = client.post('/v1/auth/reset-password', json={'token': token, 'new_password': 'Another safe city phrase! 2026'}, headers=csrf(client))
    assert reset.status_code == 200
    reused = client.post('/v1/auth/reset-password', json={'token': token, 'new_password': PASSWORD}, headers=csrf(client))
    assert reused.status_code == 400


def test_session_cookie_me_logout_and_expiry_are_server_checked(client):
    register_and_verify(client)
    response = sign_in(client)
    assert response.status_code == 200
    assert response.json()['user']['emailVerified'] is True
    cookie = response.headers['set-cookie'].lower()
    assert 'httponly' in cookie and 'samesite=lax' in cookie and 'path=/' in cookie
    assert client.get('/v1/auth/me').json()['user']['email'] == 'city@example.com'
    assert client.get('/v1/users/me/sessions').json()['sessions'][0]['current'] is True
    logout = client.post('/v1/auth/logout', headers=csrf(client))
    assert logout.status_code == 204
    assert client.get('/v1/auth/me').status_code == 401
    with client.db_engine.connect() as connection:
        from sqlalchemy.orm import Session
        assert Session(bind=connection).scalar(select(AuthSession).where(AuthSession.revoked_at.is_not(None))) is not None


def test_session_status_answers_guests_with_200_but_protected_endpoints_still_require_a_session(client):
    # A guest (no cookie) and a forged or expired cookie are normal answers here, never 401, and reveal no user.
    name = session_cookie_name(client.app.state.settings)
    for cookies in ({}, {name: 'forged-token-value'}):
        client.cookies.clear()
        for key, value in cookies.items():
            client.cookies.set(key, value)
        guest = client.get('/v1/auth/session')
        assert guest.status_code == 200
        assert guest.json() == {'authenticated': False, 'user': None}
        assert guest.headers['cache-control'] == 'no-store'
        # Access rules are unchanged: account endpoints still refuse without a valid session.
        assert client.get('/v1/auth/me').status_code == 401
        assert client.get('/v1/users/me/cities').status_code == 401
        assert client.get('/v1/users/me/sessions').status_code == 401
    client.cookies.clear()
    register_and_verify(client)
    assert sign_in(client).status_code == 200
    signed_in = client.get('/v1/auth/session')
    assert signed_in.status_code == 200
    assert signed_in.json()['authenticated'] is True
    assert signed_in.json()['user']['email'] == 'city@example.com'
    assert client.post('/v1/auth/logout', headers=csrf(client)).status_code == 204
    assert client.get('/v1/auth/session').json() == {'authenticated': False, 'user': None}


def test_profile_password_change_and_reset_revoke_other_sessions(client):
    register_and_verify(client)
    assert sign_in(client).status_code == 200
    # A second client models another browser session.
    other = TestClient(client.app)
    other.get('/v1/auth/csrf')
    other.post('/v1/auth/login', json={'email': 'city@example.com', 'password': PASSWORD}, headers=csrf(other))
    assert client.put('/v1/users/me', json={'display_name': 'New Name'}, headers=csrf(client)).json()['user']['displayName'] == 'New Name'
    changed = client.post('/v1/users/me/password', json={'current_password': PASSWORD, 'new_password': 'A new secure city phrase! 2026'}, headers=csrf(client))
    assert changed.status_code == 200
    assert other.get('/v1/auth/me').status_code == 401
    assert sign_in(client).status_code == 401
    new_password = 'A new secure city phrase! 2026'
    assert client.post('/v1/auth/login', json={'email': 'city@example.com', 'password': new_password}, headers=csrf(client)).status_code == 200
    assert client.post('/v1/auth/forgot-password', json={'email': 'city@example.com'}, headers=csrf(client)).status_code == 202
    token = re.search(r'#token=([^\s]+)', client.email_sender.messages[-1].text).group(1)
    assert client.post('/v1/auth/reset-password', json={'token': token, 'new_password': PASSWORD}, headers=csrf(client)).status_code == 200
    assert client.get('/v1/auth/me').status_code == 401


def test_cloud_saves_are_owned_revisioned_and_never_accept_client_user_id(client):
    register_and_verify(client, 'owner@example.com')
    assert sign_in(client, 'owner@example.com').status_code == 200
    create = client.post('/v1/users/me/cities', json={'name': 'My City', 'snapshot': valid_snapshot()}, headers=csrf(client))
    assert create.status_code == 201
    saved = create.json()
    assert client.get(f"/v1/users/me/cities/{saved['id']}").json()['snapshot']['saveVersion'] == 3
    assert client.get('/v1/users/me/cities').json()['saves'][0]['name'] == 'My City'
    update_body = {'name': 'Updated City', 'snapshot': valid_snapshot(), 'expected_revision': 1, 'user_id': 'attacker-id'}
    update = client.put(f"/v1/users/me/cities/{saved['id']}", json=update_body, headers=csrf(client))
    assert update.status_code == 200 and update.json()['revision'] == 2
    conflict = client.put(f"/v1/users/me/cities/{saved['id']}", json={**update_body, 'expected_revision': 1}, headers=csrf(client))
    assert conflict.status_code == 409

    other = TestClient(client.app)
    other.get('/v1/auth/csrf')
    other.post('/v1/auth/register', json={'display_name': 'Other', 'email': 'other@example.com', 'password': PASSWORD}, headers=csrf(other))
    token = re.search(r'#token=([^\s]+)', other.app.state.email_sender.messages[-1].text).group(1)
    other.post('/v1/auth/verify-email', json={'token': token}, headers=csrf(other))
    other.post('/v1/auth/login', json={'email': 'other@example.com', 'password': PASSWORD}, headers=csrf(other))
    assert other.get(f"/v1/users/me/cities/{saved['id']}").status_code == 404
    assert other.delete(f"/v1/users/me/cities/{saved['id']}", headers=csrf(other)).status_code == 404
    assert client.delete(f"/v1/users/me/cities/{saved['id']}", headers=csrf(client)).status_code == 204


def test_cloud_saves_keep_architectural_designs_verbatim(client):
    """Visual World 3.1: a building's design is editor metadata in the save envelope; cloud saves store and return
    the envelope unchanged, so the exact model survives a cloud round trip."""
    register_and_verify(client, 'designs@example.com')
    assert sign_in(client, 'designs@example.com').status_code == 200
    snapshot = valid_snapshot()
    snapshot['buildings'] = [{'id': 'building-1', 'kind': 'villa', 'x': 3, 'y': 4, 'name': 'Villa 01', 'createdAt': 1,
        'design': {'collection': 'luxury-minimalist', 'model': 'lm.villa.glass-pavilion'}}]
    created = client.post('/v1/users/me/cities', json={'name': 'Designed', 'snapshot': snapshot}, headers=csrf(client))
    assert created.status_code == 201
    loaded = client.get(f"/v1/users/me/cities/{created.json()['id']}").json()['snapshot']
    assert loaded['buildings'][0]['design'] == {'collection': 'luxury-minimalist', 'model': 'lm.villa.glass-pavilion'}


def test_cors_credentials_are_explicit_and_account_deletion_cascades(client):
    cors = client.options('/v1/auth/me', headers={'Origin': ORIGIN, 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-csrf-token'})
    assert cors.status_code == 200
    assert cors.headers['access-control-allow-origin'] == ORIGIN
    assert cors.headers['access-control-allow-credentials'] == 'true'
    assert client.options('/v1/auth/me', headers={'Origin': 'https://attacker.example', 'Access-Control-Request-Method': 'POST'}).status_code == 400
    register_and_verify(client, 'delete@example.com')
    assert sign_in(client, 'delete@example.com').status_code == 200
    save = client.post('/v1/users/me/cities', json={'name': 'Keep no data', 'snapshot': valid_snapshot()}, headers=csrf(client))
    assert save.status_code == 201
    bad = client.request('DELETE', '/v1/users/me', json={'password': 'wrong'}, headers=csrf(client))
    assert bad.status_code == 400
    deleted = client.request('DELETE', '/v1/users/me', json={'password': PASSWORD}, headers=csrf(client))
    assert deleted.status_code == 204
    assert client.get('/v1/auth/me').status_code == 401
    with client.db_engine.connect() as connection:
        from sqlalchemy.orm import Session
        session = Session(bind=connection)
        assert session.scalar(select(User).where(User.normalized_email == 'delete@example.com')) is None
        assert session.scalar(select(UserCitySave)) is None
        assert session.scalar(select(OneTimeToken)) is None


def test_production_settings_require_secure_cookies_and_postgres():
    with pytest.raises(ValidationError, match='shared PostgreSQL'):
        Settings(app_env='production', database_url='sqlite:///./production.db', session_cookie_secure=True)
