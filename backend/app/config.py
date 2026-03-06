from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "CaRun API"
    app_env: str = "local"
    debug: bool = False
    webserver_port: int = 8080

    database_url: str = Field(default="postgresql+psycopg://postgres:postgres@localhost:5432/carun")
    session_secret: str = "dev-session-secret"
    session_max_age_seconds: int = 60 * 60 * 24 * 365

    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/auth/google/callback"
    facebook_client_id: str = ""
    facebook_client_secret: str = ""
    facebook_redirect_uri: str = "http://localhost:8000/api/auth/facebook/callback"
    admin_email: str = "admin@example.com"

    frontend_dir: Path = ROOT_DIR / "frontend"
    frontend_build_id: str = "dev"
    frontend_build_label: str = "v.dev"

    model_config = SettingsConfigDict(
        env_file=ROOT_DIR / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
