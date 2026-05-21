from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://health:health@localhost:5432/health_tracker"
    batch_max_size: int = 1000

    # --- Lab module ---
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-4-7"
    lab_documents_dir: Path = Path("/app/data/lab_documents")
    # Archivio PDF per Visite / Referti / Documentazione (dominio medical_docs).
    medical_documents_dir: Path = Path("/app/data/medical_documents")

    # --- APNs (silent push) ---
    # Configurati via env nel docker-compose. La chiave .p8 va montata
    # read-only nel container al path indicato da `apns_key_path`. Se
    # `apns_key_id` o `apns_team_id` mancano, `services/apns.py` disabilita
    # il client e tutte le chiamate `send_silent_push` diventano no-op (i
    # sync iOS funzionano lo stesso, solo senza il trigger remoto on-demand).
    apns_key_id: str | None = None
    apns_team_id: str | None = None
    apns_bundle_id: str = "com.alexpani.healthtracker.app"
    apns_key_path: Path = Path("/app/data/apns/AuthKey.p8")
    # 'production' (App Store / TestFlight build) o 'sandbox' (Xcode build
    # su dispositivo dev). Usato come fallback: se la tabella `devices` ha
    # un valore esplicito (registrato dall'iOS all'apns token), quello vince
    # per il singolo device.
    apns_default_env: str = "sandbox"

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
