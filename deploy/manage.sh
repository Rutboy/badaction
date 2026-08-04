#!/usr/bin/env bash

set -Eeuo pipefail

resolve_script_directory() {
  local source_path="${BASH_SOURCE[0]}"
  local source_directory

  while [[ -L "$source_path" ]]; do
    source_directory="$(cd -P "$(dirname "$source_path")" >/dev/null 2>&1 && pwd)"
    source_path="$(readlink "$source_path")"
    if [[ "$source_path" != /* ]]; then
      source_path="$source_directory/$source_path"
    fi
  done

  cd -P "$(dirname "$source_path")" >/dev/null 2>&1 && pwd
}

readonly SCRIPT_DIRECTORY="$(resolve_script_directory)"
readonly REPOSITORY_ROOT="$(cd "$SCRIPT_DIRECTORY/.." >/dev/null 2>&1 && pwd)"
readonly ENVIRONMENT_FILE="${BADACTION_ENV_FILE:-$REPOSITORY_ROOT/.env.production}"
readonly BACKUP_DIRECTORY="$REPOSITORY_ROOT/backups"

usage() {
  cat <<'EOF'
Manage a guided Badaction installation.

Usage:
  badaction doctor
  badaction status
  badaction logs [service...]
  badaction start
  badaction stop
  badaction restart
  badaction backup [output-file]

Commands:
  doctor   Validate configuration and check local and public health.
  status   Show container state.
  logs     Show the last 100 log lines (app and Caddy by default).
  start    Build changed images and start the complete stack.
  stop     Gracefully stop the complete stack without deleting data.
  restart  Gracefully restart the application and HTTPS proxy.
  backup   Create and verify a private PostgreSQL custom-format dump.

Run this command with sudo unless your operator account can read the production
environment file and is intentionally allowed to control Docker.
EOF
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

read_environment_value() {
  local variable_name="$1"
  awk -F= -v name="$variable_name" '$1 == name { print substr($0, length(name) + 2); exit }' "$ENVIRONMENT_FILE"
}

compose() {
  docker compose \
    --env-file "$ENVIRONMENT_FILE" \
    -f "$REPOSITORY_ROOT/docker-compose.yml" \
    -f "$REPOSITORY_ROOT/docker-compose.production.yml" \
    -f "$REPOSITORY_ROOT/docker-compose.quick-start.yml" \
    --profile app \
    "$@"
}

require_installation() {
  [[ -r "$ENVIRONMENT_FILE" ]] || fail "Cannot read $ENVIRONMENT_FILE. Run with sudo or complete the guided installation first."
  [[ "$(read_environment_value BADACTION_INSTALLER_MANAGED)" == "1" ]] || fail "This helper only manages environments created by deploy/install.sh."
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed."
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is not available."
  docker info >/dev/null 2>&1 || fail "The Docker daemon is unavailable or this account cannot access it."
}

doctor() {
  local app_port
  local domain

  printf 'Checking Compose configuration...\n'
  compose config --quiet
  compose ps

  app_port="$(read_environment_value APP_PORT)"
  domain="$(read_environment_value BADACTION_DOMAIN)"

  command -v curl >/dev/null 2>&1 || fail "curl is required for health checks."
  printf '\nChecking the loopback application endpoint...\n'
  curl --fail --show-error --silent "http://127.0.0.1:${app_port}/api/health"
  printf '\nChecking the public HTTPS endpoint...\n'
  curl --fail --show-error --silent "https://${domain}/api/health"
  printf '\nAll basic health checks passed.\n'
}

create_backup() {
  local output_path="${1:-$BACKUP_DIRECTORY/badaction-$(date -u +%Y%m%dT%H%M%SZ).dump}"
  local partial_path="${output_path}.partial"

  [[ ! -e "$output_path" && ! -L "$output_path" && ! -e "$partial_path" && ! -L "$partial_path" ]] || fail "Backup output already exists: $output_path"
  install -d -m 700 "$(dirname "$output_path")"
  umask 077

  if ! compose exec -T postgres \
    sh -c 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
    >"$partial_path"; then
    rm -f -- "$partial_path"
    fail "PostgreSQL did not create the backup."
  fi
  if ! compose exec -T postgres pg_restore --list <"$partial_path" >/dev/null; then
    rm -f -- "$partial_path"
    fail "PostgreSQL could not verify the backup catalog."
  fi
  chmod 600 "$partial_path"
  mv -- "$partial_path" "$output_path"

  printf 'Backup created and verified: %s\n' "$output_path"
  printf 'Copy it to an encrypted location outside this server.\n'
}

main() {
  local command_name="${1:-help}"
  if [[ $# -gt 0 ]]; then
    shift
  fi

  case "$command_name" in
    help | --help | -h)
      usage
      ;;
    doctor)
      [[ $# -eq 0 ]] || fail "doctor does not accept arguments."
      require_installation
      doctor
      ;;
    status)
      [[ $# -eq 0 ]] || fail "status does not accept arguments."
      require_installation
      compose ps
      ;;
    logs)
      require_installation
      if [[ $# -eq 0 ]]; then
        set -- app caddy
      fi
      compose logs --tail 100 "$@"
      ;;
    start)
      [[ $# -eq 0 ]] || fail "start does not accept arguments."
      require_installation
      compose up --detach --build --wait --wait-timeout 300
      ;;
    stop)
      [[ $# -eq 0 ]] || fail "stop does not accept arguments."
      require_installation
      compose stop
      ;;
    restart)
      [[ $# -eq 0 ]] || fail "restart does not accept arguments."
      require_installation
      compose restart caddy app
      compose ps
      ;;
    backup)
      [[ $# -le 1 ]] || fail "backup accepts at most one output path."
      require_installation
      create_backup "${1:-}"
      ;;
    *)
      usage >&2
      fail "Unknown command: $command_name"
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
