"""
Generic key-value app settings.

Tabella key-value per le preferenze dell'app che devono essere **condivise
tra dispositivi/browser** (a differenza di localStorage, che e' per-browser).
App single-user self-hosted: nessuno scoping per utente. `value` e' JSONB
libero, cosi' ogni chiave puo' contenere un oggetto strutturato (es.
`regimen_reminders` = {startDays, endDays}).
"""

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from . import Base


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
