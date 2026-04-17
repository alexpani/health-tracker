from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://health:health@localhost:5432/health_tracker"
    batch_max_size: int = 1000

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
