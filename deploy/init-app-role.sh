#!/bin/sh
set -eu
# Hex passwords keep SQL and connection URL encoding unambiguous.
case "$POSTGRES_APP_PASSWORD" in
  *[!0-9a-fA-F]*|'') echo 'Application database password must be random hexadecimal' >&2; exit 1 ;;
esac
if [ "${#POSTGRES_APP_PASSWORD}" -lt 32 ]; then
  echo 'Application database password must contain at least 32 hex characters' >&2
  exit 1
fi
psql -q -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE commission_app LOGIN PASSWORD '$POSTGRES_APP_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE commission TO commission_app;
GRANT USAGE ON SCHEMA public TO commission_app;
ALTER DEFAULT PRIVILEGES FOR ROLE commission_admin IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO commission_app;
ALTER DEFAULT PRIVILEGES FOR ROLE commission_admin IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO commission_app;
SQL
