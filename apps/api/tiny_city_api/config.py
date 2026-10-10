from pathlib import Path
from pydantic import Field, SecretStr
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
    tiny_city_provider_mode: str = Field(default='gemini', pattern='^(gemini|mock)$')
    tiny_city_cors_origins: str = 'http://localhost:5173,http://127.0.0.1:5173'
    tiny_city_planner_timeout_seconds: float = Field(default=15, ge=1, le=30)
    tiny_city_max_inflight: int = Field(default=2, ge=1, le=8)
    tiny_city_requests_per_minute: int = Field(default=12, ge=1, le=120)
    tiny_city_body_limit_bytes: int = Field(default=1048576, ge=1024, le=1048576)
    tiny_city_node_binary: str = 'node'
