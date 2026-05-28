"""Configurazione runtime — letta da env (e da .env in dev)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="MCP_",
        case_sensitive=False,
        extra="ignore",
    )

    # Auth
    bearer_token: str

    # HTTP bind
    host: str = "0.0.0.0"
    port: int = 8765

    # Postgres read-only
    pg_dsn: str

    # FastAPI upstream
    api_url: str = "http://192.168.68.166:8000"

    # Safety SQL
    sql_statement_timeout_ms: int = 10_000
    sql_max_rows: int = 5_000


settings = Settings()  # type: ignore[call-arg]
