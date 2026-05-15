"""
Device registry for APNs silent push.

Una row per iPhone registrato. `device_id` e' l'UUID lato iOS gia' usato
nelle chiamate `POST /api/v1/sync/heartbeat`, `POST /api/v1/write`, ecc:
viene generato all'install dell'app e persistito in UserDefaults. La row
si auto-aggiorna a ogni call di `POST /api/v1/devices/register` (upsert su
`device_id`). Se APNs ritorna `BadDeviceToken` / `Unregistered`,
`services/apns.py` azzera `apns_token` cosi' i prossimi push non vengono
piu' tentati finche' l'app non si registra di nuovo.
"""

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from . import Base


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # UUID iOS-side (stringa cosi' restiamo compatibili col device_id
    # gia' inviato negli altri endpoint senza forzare il formato UUID).
    device_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # APNs device token (hex string, ~64 char). Nullable per supportare
    # il cleanup post-Unregistered/BadDeviceToken senza cancellare la row
    # (manteniamo lo storico last_seen_at per debug).
    apns_token: Mapped[str | None] = mapped_column(String(200))
    bundle_id: Mapped[str | None] = mapped_column(String(200))
    # 'production' o 'sandbox' — l'iOS lo determina via build config e lo
    # invia all'iscrizione. APNs ha due endpoint distinti e un token valido
    # in sandbox non lo e' in production e viceversa.
    apns_env: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_push_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
