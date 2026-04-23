from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://health:health@localhost:5432/health_tracker"
    batch_max_size: int = 1000

    # --- Lab module ---
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-4-7"
    lab_documents_dir: Path = Path("/app/data/lab_documents")

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
