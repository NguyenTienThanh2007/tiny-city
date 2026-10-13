"""Account lifecycle endpoints backed by database-owned users and opaque sessions."""
from dataclasses import dataclass, replace
from datetime import timedelta
import hmac
import uuid

from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import Settings
from .database import get_db
from .email_service import EmailDeliveryError, password_reset_email, verification_email
from .models import AuthSession, OneTimeToken, User
from .security import (ApiError, clear_auth_cookies, consume_rate_limit, csrf_cookie_name,
    csrf_dependency, new_session, new_token, request_rate_key, session_cookie_name,
    set_auth_cookies, token_hash, utcnow, validate_password, verify_password, hash_password)

router = APIRouter(prefix='/v1/auth', tags=['authentication'])
users_router = APIRouter(prefix='/v1/users/me', tags=['account'])
dev_router = APIRouter(prefix='/v1/dev', tags=['development email'])


class RegisterBody(BaseModel):
    display_name: str = Field(min_length=1, max_length=48)
    email: EmailStr
    password: str

    @field_validator('display_name')
    @classmethod
    def clean_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value or any(ord(char) < 32 for char in value):
            raise ValueError('Display name must contain visible characters.')
        return value


class EmailBody(BaseModel):
    email: EmailStr


class TokenBody(BaseModel):
    token: str = Field(min_length=32, max_length=128)


class LoginBody(EmailBody):
    password: str = Field(min_length=1, max_length=128)


class ResetBody(TokenBody):
    new_password: str


class ChangePasswordBody(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str


class ProfileBody(BaseModel):
    display_name: str = Field(min_length=1, max_length=48)

    @field_validator('display_name')
    @classmethod
    def clean_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value or any(ord(char) < 32 for char in value):
            raise ValueError('Display name must contain visible characters.')
        return value


class DeleteAccountBody(BaseModel):
    password: str = Field(min_length=1, max_length=128)


@dataclass(frozen=True)
class AuthContext:
    user: User
    auth_session: AuthSession


def normalize_email(value: str) -> str:
    try:
        result = validate_email(value.strip(), check_deliverability=False)
    except EmailNotValidError:
        raise ApiError(422, 'INVALID_EMAIL', 'Enter a valid email address.') from None
    return result.normalized.casefold()


def user_view(user: User) -> dict:
    return {
        'id': user.id,
        'displayName': user.display_name,
        'email': user.email,
        'emailVerified': user.email_verified_at is not None,
        'createdAt': user.created_at.isoformat() + 'Z',
        'lastLoginAt': user.last_login_at.isoformat() + 'Z' if user.last_login_at else None,
    }


def current_auth(request: Request, db: Session) -> tuple[AuthContext | None, str]:
    """Resolves the session cookie without raising: (context, '') or (None, reason code)."""
    settings: Settings = request.app.state.settings
    raw = request.cookies.get(session_cookie_name(settings), '')
    if not raw:
        return None, 'AUTH_REQUIRED'
    auth_session = db.scalar(select(AuthSession).where(
        AuthSession.token_hash == token_hash(raw), AuthSession.revoked_at.is_(None), AuthSession.expires_at > utcnow()))
    if auth_session is None:
        return None, 'SESSION_EXPIRED'
    user = db.get(User, auth_session.user_id)
    if user is None or user.status != 'active':
        return None, 'SESSION_EXPIRED'
    if (utcnow() - auth_session.last_seen_at).total_seconds() > 300:
        auth_session.last_seen_at = utcnow()
        db.commit()
    return AuthContext(user=user, auth_session=auth_session), ''


def require_auth(request: Request, db: Session = Depends(get_db)) -> AuthContext:
    context, reason = current_auth(request, db)
    if context is None:
        if reason == 'AUTH_REQUIRED':
            raise ApiError(401, 'AUTH_REQUIRED', 'Sign in to continue.')
        raise ApiError(401, 'SESSION_EXPIRED', 'Your session has expired. Sign in again.')
    return context


def require_verified(context: AuthContext = Depends(require_auth)) -> AuthContext:
    if context.user.email_verified_at is None:
        raise ApiError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before using account saves.')
    return context


def issue_one_time_token(db: Session, user: User, purpose: str, ttl: int) -> str:
    now = utcnow()
    db.execute(update(OneTimeToken).where(OneTimeToken.user_id == user.id,
        OneTimeToken.purpose == purpose, OneTimeToken.consumed_at.is_(None)).values(consumed_at=now))
    raw = new_token()
    db.add(OneTimeToken(token_hash=token_hash(raw), user_id=user.id, purpose=purpose,
        created_at=now, expires_at=now + timedelta(seconds=ttl)))
    return raw


def require_mail_configured(request: Request) -> None:
    if not getattr(request.app.state.email_sender, 'enabled', False):
        raise ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Account email delivery is not configured. Set up SMTP or explicitly enable the development email sink.')


def send_mail(request: Request, recipient: str, message) -> None:
    try:
        request.app.state.email_sender.send(replace(message, to=recipient))
    except EmailDeliveryError:
        raise ApiError(503, 'EMAIL_DELIVERY_FAILED', 'The email provider could not deliver this message. Try again later.') from None


def client_rate_limit(request: Request, db: Session, category: str, limit: int, identity: str = '', window: int = 60) -> None:
    consume_rate_limit(db, request_rate_key(request, category, identity), limit, window)


@router.get('/csrf')
def get_csrf(request: Request, response: Response, db: Session = Depends(get_db)):
    settings: Settings = request.app.state.settings
    cookie_name = csrf_cookie_name(settings)
    current = request.cookies.get(cookie_name, '')
    raw_session = request.cookies.get(session_cookie_name(settings), '')
    auth_session = db.scalar(select(AuthSession).where(
        AuthSession.token_hash == token_hash(raw_session), AuthSession.revoked_at.is_(None), AuthSession.expires_at > utcnow())) if raw_session else None
    if current and len(current) >= 40 and (auth_session is None or hmac.compare_digest(auth_session.csrf_hash, token_hash(current))):
        csrf = current
    else:
        csrf = new_token()
        if auth_session:
            auth_session.csrf_hash = token_hash(csrf)
            db.commit()
    response.set_cookie(cookie_name, csrf, max_age=settings.session_ttl_seconds, httponly=False,
        secure=settings.session_cookie_secure, samesite=settings.session_cookie_samesite, path='/')
    return {'csrfToken': csrf}


@router.post('/register', status_code=202, dependencies=[Depends(csrf_dependency)])
def register(body: RegisterBody, request: Request, db: Session = Depends(get_db)):
    settings: Settings = request.app.state.settings
    require_mail_configured(request)
    email = normalize_email(str(body.email))
    client_rate_limit(request, db, 'register', settings.auth_register_limit, window=3600)
    validate_password(body.password)
    user = User(id=str(uuid.uuid4()), display_name=body.display_name, email=email, normalized_email=email,
        password_hash=hash_password(body.password), email_verified_at=None, created_at=utcnow(), updated_at=utcnow())
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        # Same response for a duplicate to avoid exposing whether an address is registered.
        return {'message': 'If the address can be registered, we will send a verification email.'}
    raw = issue_one_time_token(db, user, 'verify_email', settings.verification_ttl_seconds)
    db.commit()
    send_mail(request, email, verification_email(settings, user.display_name, raw))
    return {'message': 'If the address can be registered, we will send a verification email.'}


@router.post('/verify-email', dependencies=[Depends(csrf_dependency)])
def verify_email(body: TokenBody, request: Request, db: Session = Depends(get_db)):
    settings: Settings = request.app.state.settings
    client_rate_limit(request, db, 'verify-token', settings.auth_token_limit)
    now = utcnow()
    digest = token_hash(body.token)
    result = db.execute(update(OneTimeToken).where(OneTimeToken.token_hash == digest,
        OneTimeToken.purpose == 'verify_email', OneTimeToken.consumed_at.is_(None), OneTimeToken.expires_at > now)
        .values(consumed_at=now))
    if result.rowcount != 1:
        db.rollback()
        raise ApiError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This verification link is invalid, expired, or already used.')
    token = db.get(OneTimeToken, digest)
    user = db.get(User, token.user_id) if token else None
    if user is None:
        db.rollback()
        raise ApiError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This verification link is invalid, expired, or already used.')
    user.email_verified_at = user.email_verified_at or now
    user.updated_at = now
    db.commit()
    return {'verified': True, 'message': 'Email verified. You can now sign in.'}


@router.post('/resend-verification', status_code=202, dependencies=[Depends(csrf_dependency)])
def resend_verification(body: EmailBody, request: Request, db: Session = Depends(get_db)):
    require_mail_configured(request)
    settings: Settings = request.app.state.settings
    email = normalize_email(str(body.email))
    client_rate_limit(request, db, 'resend-verification', settings.auth_email_limit, email, 3600)
    user = db.scalar(select(User).where(User.normalized_email == email, User.status == 'active'))
    if user and user.email_verified_at is None:
        raw = issue_one_time_token(db, user, 'verify_email', settings.verification_ttl_seconds)
        db.commit()
        send_mail(request, email, verification_email(settings, user.display_name, raw))
    return {'message': 'If the address needs verification, we will send a new link.'}


@router.post('/login', dependencies=[Depends(csrf_dependency)])
def login(body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)):
    settings: Settings = request.app.state.settings
    email = normalize_email(str(body.email))
    client_rate_limit(request, db, 'login-ip', settings.auth_login_limit, window=600)
    client_rate_limit(request, db, 'login-email', settings.auth_login_limit, email, 600)
    user = db.scalar(select(User).where(User.normalized_email == email, User.status == 'active'))
    valid = verify_password(body.password, user.password_hash if user else None)
    if not valid or user is None or user.email_verified_at is None:
        raise ApiError(401, 'INVALID_CREDENTIALS', 'Email, password, or verification status is incorrect.')
    # Revoke the presented session before rotating it to prevent fixation.
    raw_existing = request.cookies.get(session_cookie_name(settings))
    if raw_existing:
        prior = db.scalar(select(AuthSession).where(AuthSession.token_hash == token_hash(raw_existing), AuthSession.revoked_at.is_(None)))
        if prior:
            prior.revoked_at = utcnow()
    user.last_login_at = utcnow()
    user.updated_at = utcnow()
    auth_session, raw, csrf = new_session(db, user.id, request.headers.get('user-agent', ''), settings)
    db.commit()
    set_auth_cookies(response, settings, raw, csrf)
    return {'user': user_view(user), 'csrfToken': csrf}


@router.post('/logout', status_code=204, dependencies=[Depends(csrf_dependency)])
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    settings: Settings = request.app.state.settings
    raw = request.cookies.get(session_cookie_name(settings))
    if raw:
        auth_session = db.scalar(select(AuthSession).where(AuthSession.token_hash == token_hash(raw), AuthSession.revoked_at.is_(None)))
        if auth_session:
            auth_session.revoked_at = utcnow()
            db.commit()
    clear_auth_cookies(response, settings)
    response.status_code = 204
    return response


@router.get('/me')
def me(context: AuthContext = Depends(require_auth)):
    return {'user': user_view(context.user)}


@router.get('/session')
def session_status(request: Request, response: Response, db: Session = Depends(get_db)):
    """Who is signed in, if anyone. A guest is a normal state here (200), so the app can check it on every load;
    `/me` and every account endpoint still require a valid session and answer 401 without one."""
    response.headers['Cache-Control'] = 'no-store'
    context, _ = current_auth(request, db)
    if context is None:
        return {'authenticated': False, 'user': None}
    return {'authenticated': True, 'user': user_view(context.user)}


@router.post('/forgot-password', status_code=202, dependencies=[Depends(csrf_dependency)])
def forgot_password(body: EmailBody, request: Request, db: Session = Depends(get_db)):
    require_mail_configured(request)
    settings: Settings = request.app.state.settings
    email = normalize_email(str(body.email))
    client_rate_limit(request, db, 'forgot-password-ip', settings.auth_email_limit, window=3600)
    client_rate_limit(request, db, 'forgot-password-email', settings.auth_email_limit, email, 3600)
    user = db.scalar(select(User).where(User.normalized_email == email, User.email_verified_at.is_not(None), User.status == 'active'))
    if user:
        raw = issue_one_time_token(db, user, 'password_reset', settings.password_reset_ttl_seconds)
        # Send before commit so a provider failure does not strand a new token in the database.
        send_mail(request, email, password_reset_email(settings, user.display_name, raw))
        db.commit()
    return {'message': 'If this email has an eligible account, password reset instructions will be sent.'}


@router.post('/reset-password', dependencies=[Depends(csrf_dependency)])
def reset_password(body: ResetBody, request: Request, response: Response, db: Session = Depends(get_db)):
    settings: Settings = request.app.state.settings
    client_rate_limit(request, db, 'reset-token', settings.auth_token_limit)
    validate_password(body.new_password)
    now, digest = utcnow(), token_hash(body.token)
    result = db.execute(update(OneTimeToken).where(OneTimeToken.token_hash == digest,
        OneTimeToken.purpose == 'password_reset', OneTimeToken.consumed_at.is_(None), OneTimeToken.expires_at > now)
        .values(consumed_at=now))
    if result.rowcount != 1:
        db.rollback()
        raise ApiError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This password reset link is invalid, expired, or already used.')
    token = db.get(OneTimeToken, digest)
    user = db.get(User, token.user_id) if token else None
    if user is None:
        db.rollback()
        raise ApiError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This password reset link is invalid, expired, or already used.')
    user.password_hash = hash_password(body.new_password)
    user.updated_at = now
    db.execute(update(AuthSession).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)).values(revoked_at=now))
    db.execute(update(OneTimeToken).where(OneTimeToken.user_id == user.id, OneTimeToken.purpose == 'password_reset',
        OneTimeToken.consumed_at.is_(None)).values(consumed_at=now))
    db.commit()
    clear_auth_cookies(response, settings)
    return {'message': 'Password changed. Sign in with your new password.'}


@users_router.get('')
def profile(context: AuthContext = Depends(require_auth)):
    return {'user': user_view(context.user)}


@users_router.put('', dependencies=[Depends(csrf_dependency)])
def update_profile(body: ProfileBody, context: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    context.user.display_name = body.display_name
    context.user.updated_at = utcnow()
    db.commit()
    return {'user': user_view(context.user)}


@users_router.post('/password', dependencies=[Depends(csrf_dependency)])
def change_password(body: ChangePasswordBody, request: Request, response: Response,
                    context: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    settings: Settings = request.app.state.settings
    if not verify_password(body.current_password, context.user.password_hash):
        raise ApiError(400, 'CURRENT_PASSWORD_INVALID', 'The current password is incorrect.')
    validate_password(body.new_password)
    now = utcnow()
    context.user.password_hash = hash_password(body.new_password)
    context.user.updated_at = now
    db.execute(update(AuthSession).where(AuthSession.user_id == context.user.id,
        AuthSession.revoked_at.is_(None), AuthSession.id != context.auth_session.id).values(revoked_at=now))
    # Rotate the current browser session, keep the user signed in here and invalidate its old token.
    context.auth_session.revoked_at = now
    auth_session, raw, csrf = new_session(db, context.user.id, request.headers.get('user-agent', ''), settings)
    db.commit()
    set_auth_cookies(response, settings, raw, csrf)
    return {'user': user_view(context.user), 'csrfToken': csrf, 'message': 'Password updated. Other sessions were signed out.'}


@users_router.get('/sessions')
def sessions(request: Request, context: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    now = utcnow()
    rows = db.scalars(select(AuthSession).where(AuthSession.user_id == context.user.id,
        AuthSession.revoked_at.is_(None), AuthSession.expires_at > now).order_by(AuthSession.created_at.desc())).all()
    return {'sessions': [{
        'id': item.id,
        'current': item.id == context.auth_session.id,
        'createdAt': item.created_at.isoformat() + 'Z',
        'lastSeenAt': item.last_seen_at.isoformat() + 'Z',
        'expiresAt': item.expires_at.isoformat() + 'Z',
        'device': (item.user_agent or 'Unknown device')[:128],
    } for item in rows]}


@users_router.delete('/sessions/{session_id}', dependencies=[Depends(csrf_dependency)])
def revoke_session(session_id: str, context: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    item = db.scalar(select(AuthSession).where(AuthSession.id == session_id, AuthSession.user_id == context.user.id,
        AuthSession.revoked_at.is_(None)))
    if item is None:
        raise ApiError(404, 'SESSION_NOT_FOUND', 'That session is no longer active.')
    item.revoked_at = utcnow()
    db.commit()
    return {'revoked': True, 'current': item.id == context.auth_session.id}


@users_router.delete('/sessions', status_code=204, dependencies=[Depends(csrf_dependency)])
def revoke_all_sessions(response: Response, request: Request, context: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    now = utcnow()
    db.execute(update(AuthSession).where(AuthSession.user_id == context.user.id,
        AuthSession.revoked_at.is_(None)).values(revoked_at=now))
    db.commit()
    clear_auth_cookies(response, request.app.state.settings)
    response.status_code = 204
    return response


@users_router.delete('', status_code=204, dependencies=[Depends(csrf_dependency)])
def delete_account(body: DeleteAccountBody, response: Response, request: Request,
                   context: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    if not verify_password(body.password, context.user.password_hash):
        raise ApiError(400, 'CURRENT_PASSWORD_INVALID', 'Enter your password to confirm account deletion.')
    user_id = context.user.id
    clear_auth_cookies(response, request.app.state.settings)
    db.execute(delete(User).where(User.id == user_id))
    db.commit()
    response.status_code = 204
    return response


@dev_router.get('/mailbox')
def development_mailbox(request: Request, email: EmailStr | None = None):
    settings: Settings = request.app.state.settings
    sender = request.app.state.email_sender
    if settings.app_env not in ('development', 'test') or not settings.dev_email_sink_enabled or not hasattr(sender, 'messages'):
        raise ApiError(404, 'NOT_FOUND', 'This development-only route is unavailable.')
    messages = sender.messages
    normalized = normalize_email(str(email)) if email else None
    if normalized:
        messages = [message for message in messages if message.to.casefold() == normalized]
    return {'messages': [{'to': item.to, 'subject': item.subject, 'text': item.text} for item in messages[-20:]]}
