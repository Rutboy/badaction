#!/bin/sh

set -eu

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${POSTGRES_MIGRATOR_USER:?POSTGRES_MIGRATOR_USER is required}"
: "${POSTGRES_MIGRATOR_PASSWORD:?POSTGRES_MIGRATOR_PASSWORD is required}"
: "${POSTGRES_RUNTIME_USER:?POSTGRES_RUNTIME_USER is required}"
: "${POSTGRES_RUNTIME_PASSWORD:?POSTGRES_RUNTIME_PASSWORD is required}"

validate_role_name() {
  case "$1" in
    "" | [0-9]* | *[!a-z0-9_]*)
      echo "Production PostgreSQL role names must match [a-z_][a-z0-9_]{0,62}" >&2
      exit 1
      ;;
  esac
  if [ "${#1}" -gt 63 ]; then
    echo "Production PostgreSQL role names must not exceed 63 characters" >&2
    exit 1
  fi
}

validate_role_name "$POSTGRES_USER"
validate_role_name "$POSTGRES_MIGRATOR_USER"
validate_role_name "$POSTGRES_RUNTIME_USER"

if [ "$POSTGRES_MIGRATOR_USER" = "$POSTGRES_RUNTIME_USER" ] \
  || [ "$POSTGRES_MIGRATOR_USER" = "$POSTGRES_USER" ] \
  || [ "$POSTGRES_RUNTIME_USER" = "$POSTGRES_USER" ]; then
  echo "Production PostgreSQL admin, migrator, and runtime roles must be distinct" >&2
  exit 1
fi

if [ "$POSTGRES_PASSWORD" = "$POSTGRES_MIGRATOR_PASSWORD" ] \
  || [ "$POSTGRES_PASSWORD" = "$POSTGRES_RUNTIME_PASSWORD" ] \
  || [ "$POSTGRES_MIGRATOR_PASSWORD" = "$POSTGRES_RUNTIME_PASSWORD" ]; then
  echo "Production PostgreSQL admin, migrator, and runtime passwords must be distinct" >&2
  exit 1
fi

if [ "${#POSTGRES_PASSWORD}" -lt 32 ] \
  || [ "${#POSTGRES_MIGRATOR_PASSWORD}" -lt 32 ] \
  || [ "${#POSTGRES_RUNTIME_PASSWORD}" -lt 32 ]; then
  echo "Production PostgreSQL passwords must contain at least 32 characters" >&2
  exit 1
fi

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv database_name POSTGRES_DB
\getenv migrator_user POSTGRES_MIGRATOR_USER
\getenv migrator_password POSTGRES_MIGRATOR_PASSWORD
\getenv runtime_user POSTGRES_RUNTIME_USER
\getenv runtime_password POSTGRES_RUNTIME_PASSWORD

CREATE ROLE :"migrator_user"
  WITH LOGIN PASSWORD :'migrator_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE :"runtime_user"
  WITH LOGIN PASSWORD :'runtime_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

REVOKE ALL ON DATABASE :"database_name" FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE :"database_name" TO :"migrator_user", :"runtime_user";
GRANT CREATE ON DATABASE :"database_name" TO :"migrator_user";
GRANT USAGE, CREATE ON SCHEMA public TO :"migrator_user";
GRANT USAGE ON SCHEMA public TO :"runtime_user";

ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"runtime_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"runtime_user";
SQL
