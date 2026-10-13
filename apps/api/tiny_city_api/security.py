"""Password, opaque token, cookie, CSRF and database-backed throttling helpers."""
from datetime import UTC, datetime, timedelta
import hashlib
import hmac
import secrets
import uuid

from fastapi import Depends, Request
from sqlalchemy import case, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session
from pwdlib import PasswordHash

from .config import Settings
from .database import get_db
from .models import AuthSession, RateLimitBucket


password_hasher = PasswordHash.recommended()  # Argon2id; parameters are supplied by the maintained library.
_dummy_password_hash = password_hasher.hash('dummy-password-that-is-never-a-user-credential')


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


def utcnow() -> datetime:
    # Naive UTC is used consistently because SQLite drops timezone offsets on round trip.
    return datetime.now(UTC).replace(tzinfo=None)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, encoded: str | None) -> bool:
    try:
        return password_hasher.verify(password, encoded or _dummy_password_hash) and encoded is not None
    except (ValueError, TypeError):
        return False


def validate_password(password: str) -> None:
    if len(password) < 12:
        raise ApiError(422, 'WEAK_PASSWORD', 'Use a password with at least 12 characters.')
    if len(password) > 128 or len(password.encode('utf-8')) > 1024:
        raise ApiError(422, 'PASSWORD_TOO_LONG', 'Password must be 128 characters or fewer.')


def session_cookie_name(settings: Settings) -> str:
    return '__Host-tiny_city_session' if settings.session_cookie_secure else 'tiny_city_session'


def csrf_cookie_name(settings: Settings) -> str:
    return '__Host-tiny_city_csrf' if settings.session_cookie_secure else 'tiny_city_csrf'


def set_auth_cookies(response, settings: Settings, session_token: str, csrf_token: str) -> None:
    response.set_cookie(session_cookie_name(settings), session_token, max_age=settings.session_ttl_seconds,
        httponly=True, secure=settings.session_cookie_secure, samesite=settings.session_cookie_samesite, path='/')
    response.set_cookie(csrf_cookie_name(settings), csrf_token, max_age=settings.session_ttl_seconds,
        httponly=False, secure=settings.session_cookie_secure, samesite=settings.session_cookie_samesite, path='/')


def clear_auth_cookies(response, settings: Settings) -> None:
    for name, http_only in ((session_cookie_name(settings), True), (csrf_cookie_name(settings), False)):
        response.delete_cookie(name, path='/', secure=settings.session_cookie_secure, httponly=http_only, samesite=settings.session_cookie_samesite)


def allowed_origins(settings: Settings) -> set[str]:
    return {origin.strip().rstrip('/') for origin in settings.tiny_city_cors_origins.split(',') if origin.strip()}


def validate_csrf(request: Request, settings: Settings, db: Session) -> str:
    origin = request.headers.get('origin', '').rstrip('/')
    if not origin or origin not in allowed_origins(settings):
        raise ApiError(403, 'ORIGIN_DENIED', 'This request origin is not allowed.')
    if request.headers.get('sec-fetch-site', '').lower() == 'cross-site':
        raise ApiError(403, 'CSRF_REJECTED', 'The security token is missing or expired. Refresh and try again.')
    cookie_token = request.cookies.get(csrf_cookie_name(settings), '')
    header_token = request.headers.get('x-csrf-token', '')
    if not cookie_token or len(cookie_token) < 40 or not hmac.compare_digest(cookie_token, header_token):
        raise ApiError(403, 'CSRF_REJECTED', 'The security token is missing or expired. Refresh and try again.')

    raw_session = request.cookies.get(session_cookie_name(settings))
    if raw_session:
        session = db.scalar(select(AuthSession).where(
            AuthSession.token_hash == token_hash(raw_session), AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > utcnow()))
        if session and not hmac.compare_digest(session.csrf_hash, token_hash(header_token)):
            raise ApiError(403, 'CSRF_REJECTED', 'The security token is missing or expired. Refresh and try again.')
    return header_token


def consume_rate_limit(db: Session, key: str, limit: int, window_seconds: int, now: datetime | None = None) -> None:
    now = now or utcnow()
    digest = token_hash(key)
    cutoff = now - timedelta(seconds=window_seconds)
    dialect = db.get_bind().dialect.name
    if dialect == 'sqlite':
        insert = sqlite_insert(RateLimitBucket)
    elif dialect == 'postgresql':
        insert = pg_insert(RateLimitBucket)
    else:
        raise RuntimeError('Authentication rate limiting requires SQLite or PostgreSQL.')
    reset = RateLimitBucket.window_started_at <= cutoff
    statement = insert.values(key_hash=digest, window_started_at=now, count=1).on_conflict_do_update(
        index_elements=[RateLimitBucket.key_hash],
        set_={
            'window_started_at': case((reset, now), else_=RateLimitBucket.window_started_at),
            'count': case((reset, 1), else_=RateLimitBucket.count + 1),
        },
    ).returning(RateLimitBucket.count)
    count = db.scalar(statement)
    db.commit()
    if count and count > limit:
        raise ApiError(429, 'RATE_LIMITED', 'Too many requests. Wait a little and try again.')


def request_rate_key(request: Request, category: str, identity: str = '') -> str:
    host = request.client.host if request.client else 'unknown'
    return f'{category}:{host}:{identity.casefold().strip()}'


def new_session(db: Session, user_id: str, user_agent: str, settings: Settings) -> tuple[AuthSession, str, str]:
    raw_session, raw_csrf = new_token(), new_token()
    now = utcnow()
    auth_session = AuthSession(id=str(uuid.uuid4()), user_id=user_id, token_hash=token_hash(raw_session),
        csrf_hash=token_hash(raw_csrf), created_at=now, expires_at=now + timedelta(seconds=settings.session_ttl_seconds),
        last_seen_at=now, user_agent=user_agent[:256])
    db.add(auth_session)
    return auth_session, raw_session, raw_csrf


def csrf_dependency(request: Request, db: Session = Depends(get_db)) -> str:
    return validate_csrf(request, request.app.state.settings, db)
