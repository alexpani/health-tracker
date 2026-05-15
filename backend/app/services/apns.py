"""
APNs silent push service.

Funziona con APNs Auth Key (`.p8`) + JWT — l'approccio moderno, l'unico
firmabile senza certificati X.509.

API: `await send_silent_push(db, device_id, reason)`.

Comportamento:
- Cerca la row `devices` per `device_id`, prende `apns_token` + `apns_env`.
- Se manca config (`apns_key_id` / `apns_team_id` non settati) o se il
  device non e' registrato / ha `apns_token IS NULL`: no-op silenzioso (i
  trigger HKObserver/SLC/BG/foreground gestiscono comunque il sync, il
  push e' solo un accelleratore).
- Inviato payload `{"aps": {"content-available": 1}, "reason": "..."}`
  con `apns-priority=5` (silent push richiede priority bassa) e
  `apns-push-type=background`.
- Se APNs ritorna `BadDeviceToken` / `Unregistered` / `DeviceTokenNotForTopic`,
  azzera `apns_token` sulla row (l'iOS si re-registrera' al prossimo launch
  con `registerForRemoteNotifications()`).
- Update `last_push_at` su successo.

Le chiamate sono fire-and-forget dai router (`asyncio.create_task(...)`);
tutte le eccezioni sono catturate e loggate, mai propagate al chiamante:
fallire a inviare un silent push NON deve far fallire una POST /write o
/delete/plan.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.devices import Device

logger = logging.getLogger(__name__)


# Cache lazy del client APNs per ambiente. `aioapns` mantiene una connessione
# HTTP/2 persistente — istanziamo una volta e riutilizziamo.
_clients: dict[str, Any] = {}

# Strong reference set per le task fire-and-forget: senza, asyncio.create_task
# puo' essere garbage-collected prima di completare. Pattern canonico Python
# (vedi https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task).
_BG_TASKS: set[asyncio.Task] = set()


def _spawn_bg(coro) -> None:
    """Lancia una coroutine in background tenendo una strong reference."""
    try:
        task = asyncio.create_task(coro)
    except RuntimeError as exc:
        logger.warning("APNs: no running event loop: %s", exc)
        return
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)


def _is_configured() -> bool:
    """True se abbiamo le credenziali APNs minime per provare l'invio."""
    if not settings.apns_key_id or not settings.apns_team_id:
        return False
    if not settings.apns_key_path or not settings.apns_key_path.exists():
        return False
    return True


def _get_client(env: str):
    """
    Ritorna (e cachea) un client APNs configurato per l'ambiente richiesto.
    `env` deve essere 'production' o 'sandbox'. Import locale di aioapns
    per evitare di esplodere all'import del modulo se la lib non e'
    installata (es. durante test unitari senza requirements completi).
    """
    if env not in ("production", "sandbox"):
        env = settings.apns_default_env
    if env in _clients:
        return _clients[env]

    try:
        from aioapns import APNs
    except ImportError:
        logger.warning("aioapns not installed — silent push disabled")
        return None

    use_sandbox = env == "sandbox"
    try:
        # aioapns vuole il CONTENUTO PEM del .p8, non il path.
        key_content = settings.apns_key_path.read_text(encoding="utf-8")
        client = APNs(
            key=key_content,
            key_id=settings.apns_key_id,
            team_id=settings.apns_team_id,
            topic=settings.apns_bundle_id,
            use_sandbox=use_sandbox,
        )
    except Exception as exc:
        logger.error("APNs client init failed (env=%s): %s", env, exc)
        return None

    _clients[env] = client
    return client


async def send_silent_push(
    db: AsyncSession,
    device_id: str,
    reason: str,
) -> bool:
    """
    Invia silent push a un singolo device. Ritorna True se inviato con
    successo. Mai solleva (eccezioni catturate internamente).
    """
    if not _is_configured():
        # No-op silenzioso: il sistema funziona senza push, e' solo un
        # acceleratore. Loggiamo a debug per non spammare il log al boot.
        logger.debug("APNs not configured — skip push for device=%s reason=%s", device_id, reason)
        return False

    try:
        result = await db.execute(
            select(Device).where(Device.device_id == device_id)
        )
        device = result.scalar_one_or_none()
    except Exception as exc:
        logger.error("APNs: device lookup failed for %s: %s", device_id, exc)
        return False

    if device is None or not device.apns_token:
        logger.debug("APNs: device %s not registered or token cleared", device_id)
        return False

    env = device.apns_env or settings.apns_default_env
    client = _get_client(env)
    if client is None:
        return False

    try:
        from aioapns import NotificationRequest, PushType
    except ImportError:
        return False

    request = NotificationRequest(
        device_token=device.apns_token,
        message={
            "aps": {"content-available": 1},
            "reason": reason,
        },
        push_type=PushType.BACKGROUND,
        # priority: aioapns legge un int sull'header `apns-priority`. Per
        # silent push Apple richiede 5 (low). Non passiamo l'enum perche'
        # aioapns 4.x non lo richiede — un int int va bene.
        priority=5,
    )

    try:
        response = await client.send_notification(request)
    except Exception as exc:
        logger.error("APNs send failed for device=%s reason=%s: %s", device_id, reason, exc)
        return False

    # `response.is_successful` per aioapns; status / description per debug
    if getattr(response, "is_successful", False):
        try:
            await db.execute(
                update(Device)
                .where(Device.device_id == device_id)
                .values(last_push_at=datetime.now(timezone.utc))
            )
            await db.commit()
        except Exception as exc:
            logger.warning("APNs: failed to update last_push_at: %s", exc)
        logger.info("APNs push sent: device=%s reason=%s", device_id, reason)
        return True

    # Token invalidato lato Apple — cleanup
    description = getattr(response, "description", "") or ""
    if description in ("BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"):
        try:
            await db.execute(
                update(Device)
                .where(Device.device_id == device_id)
                .values(apns_token=None)
            )
            await db.commit()
            logger.info("APNs: token invalidated (%s) — cleared for device=%s", description, device_id)
        except Exception as exc:
            logger.warning("APNs: failed to clear stale token: %s", exc)
    else:
        logger.warning(
            "APNs push failed: device=%s reason=%s status=%s desc=%s",
            device_id, reason,
            getattr(response, "status", "?"),
            description,
        )
    return False


def fire_and_forget_push(device_id: str | None, reason: str) -> None:
    """
    Helper per i router: lancia un push in background senza bloccare la
    response. La session di FastAPI viene chiusa al return, quindi qui
    apriamo una sessione indipendente.
    """
    if not device_id:
        return

    async def _run() -> None:
        from app.database import async_session

        try:
            async with async_session() as session:
                await send_silent_push(session, device_id, reason)
        except Exception as exc:
            logger.error("fire_and_forget_push crash: %s", exc)

    _spawn_bg(_run())


def fire_and_forget_push_all(reason: str) -> None:
    """
    Push silenzioso a TUTTI i device registrati che hanno un `apns_token`
    valido. Usato dai router che enqueue lavoro per l'iPhone senza un
    device_id esplicito (POST /write, POST /delete/plan, ecc) — il setup
    e' single-user, in pratica c'e' 1 device, ma e' robusto se in futuro
    si aggiungono un iPad o un secondo iPhone.

    Tutto il lavoro (lookup devices + N push paralleli) gira in un task
    slegato dal request scope, niente eccezioni propagate.
    """

    async def _run() -> None:
        from app.database import async_session

        try:
            async with async_session() as session:
                result = await session.execute(
                    select(Device).where(Device.apns_token.is_not(None))
                )
                devices = list(result.scalars().all())
        except Exception as exc:
            logger.error("fire_and_forget_push_all device lookup failed: %s", exc)
            return

        if not devices:
            logger.debug("APNs push_all: no registered devices for reason=%s", reason)
            return

        logger.info("APNs push_all: sending to %d device(s) for reason=%s", len(devices), reason)

        # Push paralleli: ogni task apre la sua sessione cosi' un fallimento
        # su un device non blocca gli altri.
        async def _push_one(device_id: str) -> None:
            from app.database import async_session as _ses

            async with _ses() as session:
                await send_silent_push(session, device_id, reason)

        await asyncio.gather(
            *(_push_one(d.device_id) for d in devices), return_exceptions=True
        )

    _spawn_bg(_run())
