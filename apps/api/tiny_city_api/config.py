from pathlib import Path
from typing import Literal
from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parents[1]

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=API_ROOT / '.env', env_file_encoding='utf-8', extra='ignore')
    gemini_api_key: SecretStr = SecretStr('')
    gemini_model: str = Field(default='gemini-3.5-flash-lite', min_length=1, max_length=100)
    gemini_timeout_seconds: float = Field(default=20, ge=1, le=60)
    gemini_retries: int = Field(default=1, ge=0, le=2)
    gemini_max_output_tokens: int = Field(default=4096, ge=256, le=8192)
    gemini_max_context_chars: int = Field(default=32000, ge=1000, le=64000)
    # gemini: paid interpretation; mock: fixed demo fixture; local: deterministic offline VI/EN rules (no AI calls).
    tiny_city_provider_mode: str = Field(default='gemini', pattern='^(gemini|mock|local)$')
    tiny_city_cors_origins: str = 'http://localhost:5173,http://127.0.0.1:5173'
    tiny_city_planner_timeout_seconds: float = Field(default=15, ge=1, le=30)
    tiny_city_max_inflight: int = Field(default=2, ge=1, le=8)
    tiny_city_requests_per_minute: int = Field(default=12, ge=1, le=120)
    tiny_city_body_limit_bytes: int = Field(default=1048576, ge=1024, le=1048576)
    tiny_city_node_binary: str = 'node'

    # Account system. SQLite is a local default; production deployments must provide a shared
    # PostgreSQL DATABASE_URL and run Alembic migrations before starting the API.
    app_env: Literal['development', 'test', 'production'] = 'development'
    database_url: str = 'sqlite:///./tiny_city.db'
    session_cookie_secure: bool = False
    session_cookie_samesite: Literal['lax', 'strict', 'none'] = 'lax'
    session_ttl_seconds: int = Field(default=2_592_000, ge=300, le=31_536_000)
    verification_ttl_seconds: int = Field(default=86_400, ge=300, le=604_800)
    password_reset_ttl_seconds: int = Field(default=1_800, ge=300, le=3_600)
    max_user_city_saves: int = Field(default=30, ge=1, le=500)
    max_cloud_save_bytes: int = Field(default=1_048_576, ge=16_384, le=8_388_608)
    auth_email_backend: Literal['disabled', 'smtp', 'dev_sink'] = 'disabled'
    dev_email_sink_enabled: bool = False
    smtp_host: str = ''
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: str = ''
    smtp_password: SecretStr = SecretStr('')
    smtp_from_email: str = ''
    smtp_use_starttls: bool = True
    frontend_base_url: str = 'http://localhost:5173'
    auth_login_limit: int = Field(default=10, ge=1, le=100)
    auth_register_limit: int = Field(default=5, ge=1, le=100)
    auth_email_limit: int = Field(default=4, ge=1, le=100)
    auth_token_limit: int = Field(default=20, ge=1, le=200)

    @model_validator(mode='after')
    def validate_auth_configuration(self):
        if self.app_env == 'production':
            if not self.session_cookie_secure:
                raise ValueError('SESSION_COOKIE_SECURE must be true in production')
            if self.auth_email_backend == 'dev_sink' or self.dev_email_sink_enabled:
                raise ValueError('The development email sink is forbidden in production')
            if self.database_url.startswith('sqlite:'):
                raise ValueError('Production requires a shared PostgreSQL DATABASE_URL')
        if self.session_cookie_samesite == 'none' and not self.session_cookie_secure:
            raise ValueError('SameSite=None cookies require SESSION_COOKIE_SECURE=true')
        if self.auth_email_backend == 'dev_sink' and not self.dev_email_sink_enabled:
            raise ValueError('The dev email sink requires DEV_EMAIL_SINK_ENABLED=true')
        if self.auth_email_backend == 'smtp' and (not self.smtp_host or not self.smtp_from_email):
            raise ValueError('SMTP_HOST and SMTP_FROM_EMAIL are required for SMTP delivery')
        if not self.frontend_base_url.startswith(('http://', 'https://')):
            raise ValueError('FRONTEND_BASE_URL must be an http(s) URL')
        if not self.database_url.startswith(('sqlite:', 'postgresql:', 'postgresql+')):
            raise ValueError('DATABASE_URL must use SQLite or PostgreSQL')
        if '*' in self.tiny_city_cors_origins:
            raise ValueError('CORS origins must be explicitly listed; wildcard origins are not allowed')
        return self
