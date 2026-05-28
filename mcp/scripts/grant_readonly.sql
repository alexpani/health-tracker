-- Crea utente Postgres health_ro con SELECT-only su tutte le tabelle del progetto.
-- Da eseguire UNA TANTUM sulla LXC backend (192.168.68.166).
--
-- ssh root@192.168.68.166 "docker exec -i health-tracker-db psql -U health -d health_tracker" < grant_readonly.sql
--
-- Idempotente: i blocchi DO gestiscono "role exists" senza fallire.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_ro') THEN
    CREATE ROLE health_ro WITH LOGIN PASSWORD 'PUT_PASSWORD_HERE'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION
      CONNECTION LIMIT 5;
  END IF;
END
$$;

-- Limiti per sessione: 10s timeout, kill se idle in transaction per 30s.
ALTER ROLE health_ro SET statement_timeout = '10s';
ALTER ROLE health_ro SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE health_ro SET lock_timeout = '2s';

-- Connect al DB.
GRANT CONNECT ON DATABASE health_tracker TO health_ro;
GRANT USAGE ON SCHEMA public TO health_ro;

-- SELECT su tutte le tabelle esistenti.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO health_ro;

-- E anche su quelle future (es. nuove migration).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO health_ro;

-- Niente accesso a sequenze, funzioni, ecc.: di default non lo ha.

-- Revoke esplicito su tabelle "operative" che non servono e potrebbero contenere dati transient.
-- Decommenta se vuoi escluderle dalla visibilita' di Claude.
-- REVOKE SELECT ON pending_writes, pending_deletions, devices, ingest_blacklist FROM health_ro;
