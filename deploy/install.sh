#!/usr/bin/env bash

set -Eeuo pipefail

readonly DEFAULT_INSTALL_DIRECTORY="/opt/badaction"
readonly DEFAULT_REPOSITORY_URL="https://github.com/Rutboy/badaction.git"
readonly DEFAULT_REPOSITORY_REF="main"

INSTALL_DIRECTORY="$DEFAULT_INSTALL_DIRECTORY"
REPOSITORY_URL="$DEFAULT_REPOSITORY_URL"
REPOSITORY_REF="$DEFAULT_REPOSITORY_REF"
SOURCE_DIRECTORY=""
DOMAIN=""
ACME_EMAIL=""
ASSUME_YES=0
DRY_RUN=0
SKIP_DNS_CHECK=0
SKIP_DOCKER_INSTALL=0

usage() {
  cat <<'EOF'
Guided production installation for Badaction.

Usage:
  sudo bash deploy/install.sh [options]

Options:
  --domain DOMAIN          Public DNS name, for example retro.example.com.
  --email EMAIL            Email used for automatic TLS certificate notices.
  --install-dir PATH       Clone destination when run as a downloaded script
                           (default: /opt/badaction).
  --source-dir PATH        Use an existing reviewed Badaction checkout.
  --repository URL         Git repository used for bootstrap cloning.
  --ref REF                Git branch or tag used for bootstrap cloning.
  --yes                    Accept confirmations; domain and email are still
                           required when no interactive terminal is available.
  --skip-dns-check         Continue without resolving the domain first.
  --skip-docker-install    Do not offer to install Docker when it is missing.
  --dry-run                Validate input and describe actions without changes.
  --help                   Show this help.

The installer supports a fresh single-host deployment. It never deletes Docker
volumes and never overwrites an existing production environment file.
EOF
}

log() {
  printf '\n==> %s\n' "$*"
}

warn() {
  printf 'Warning: %s\n' "$*" >&2
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

on_error() {
  local exit_code=$?
  local line_number="${BASH_LINENO[0]:-unknown}"
  printf '\nInstallation stopped at line %s (exit %s).\n' "$line_number" "$exit_code" >&2
  printf 'No Docker volumes were deleted. Fix the reported problem and run the installer again.\n' >&2
  exit "$exit_code"
}

trap on_error ERR

normalize_domain() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  printf '%s' "${value%.}"
}

is_valid_domain() {
  local value="$1"
  local label
  local final_label=""
  local old_ifs="$IFS"
  local labels=()

  [[ ${#value} -le 253 && "$value" == *.* ]] || return 1
  [[ "$value" != *..* && "$value" != .* && "$value" != *. ]] || return 1
  IFS='.' read -r -a labels <<<"$value"
  IFS="$old_ifs"

  for label in "${labels[@]}"; do
    [[ ${#label} -ge 1 && ${#label} -le 63 ]] || return 1
    [[ "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || return 1
    final_label="$label"
  done

  [[ "$final_label" =~ [a-z] ]] || return 1
}

is_valid_email() {
  local value="$1"
  [[ ${#value} -le 254 && "$value" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$ ]]
}

parse_arguments() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain)
        [[ $# -ge 2 ]] || fail "--domain requires a value."
        DOMAIN="$2"
        shift 2
        ;;
      --domain=*)
        DOMAIN="${1#*=}"
        shift
        ;;
      --email)
        [[ $# -ge 2 ]] || fail "--email requires a value."
        ACME_EMAIL="$2"
        shift 2
        ;;
      --email=*)
        ACME_EMAIL="${1#*=}"
        shift
        ;;
      --install-dir)
        [[ $# -ge 2 ]] || fail "--install-dir requires a value."
        INSTALL_DIRECTORY="$2"
        shift 2
        ;;
      --source-dir)
        [[ $# -ge 2 ]] || fail "--source-dir requires a value."
        SOURCE_DIRECTORY="$2"
        shift 2
        ;;
      --repository)
        [[ $# -ge 2 ]] || fail "--repository requires a value."
        REPOSITORY_URL="$2"
        shift 2
        ;;
      --ref)
        [[ $# -ge 2 ]] || fail "--ref requires a value."
        REPOSITORY_REF="$2"
        shift 2
        ;;
      --yes)
        ASSUME_YES=1
        shift
        ;;
      --skip-dns-check)
        SKIP_DNS_CHECK=1
        shift
        ;;
      --skip-docker-install)
        SKIP_DOCKER_INSTALL=1
        shift
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --help | -h)
        usage
        exit 0
        ;;
      *)
        fail "Unknown option: $1"
        ;;
    esac
  done
}

confirm() {
  local prompt="$1"
  local answer

  if [[ "$ASSUME_YES" == "1" ]]; then
    return 0
  fi
  [[ -t 0 ]] || fail "$prompt Re-run interactively or pass --yes."
  read -r -p "$prompt [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" || "$answer" == "yes" || "$answer" == "YES" ]]
}

collect_input() {
  local input_value

  if [[ -z "$DOMAIN" ]]; then
    [[ -t 0 ]] || fail "--domain is required without an interactive terminal."
    read -r -p "Public domain (for example retro.example.com): " input_value
    DOMAIN="$input_value"
  fi
  DOMAIN="$(normalize_domain "$DOMAIN")"
  is_valid_domain "$DOMAIN" || fail "Use a DNS hostname without https://, a port, a path, or a trailing slash."

  if [[ -z "$ACME_EMAIL" ]]; then
    [[ -t 0 ]] || fail "--email is required without an interactive terminal."
    read -r -p "Email for TLS certificate notices: " input_value
    ACME_EMAIL="$input_value"
  fi
  is_valid_email "$ACME_EMAIL" || fail "The TLS contact email is not valid."
}

require_root() {
  if [[ "$DRY_RUN" == "0" && "$EUID" -ne 0 ]]; then
    fail "Run the installer as root, for example: sudo bash deploy/install.sh"
  fi
}

repository_is_valid() {
  local path="$1"
  [[ -f "$path/docker-compose.yml" \
    && -f "$path/docker-compose.production.yml" \
    && -f "$path/docker-compose.quick-start.yml" \
    && -f "$path/deploy/production.env.example" \
    && -f "$path/deploy/caddy/Caddyfile" \
    && -x "$path/deploy/manage.sh" ]]
}

detect_embedded_repository() {
  local script_directory
  script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
  if repository_is_valid "$script_directory/.."; then
    SOURCE_DIRECTORY="$(cd "$script_directory/.." >/dev/null 2>&1 && pwd)"
  fi
}

read_os_release() {
  [[ -r /etc/os-release ]] || fail "Cannot identify this Linux distribution. Install Docker and Git manually, then retry with --skip-docker-install."
  # shellcheck disable=SC1091
  source /etc/os-release
  INSTALLER_OS_ID="${ID:-}"
  INSTALLER_OS_CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
  [[ "$INSTALLER_OS_ID" == "ubuntu" || "$INSTALLER_OS_ID" == "debian" ]] || fail "Automatic package installation supports Debian and Ubuntu only. Install Docker and Git manually, then retry."
  [[ -n "$INSTALLER_OS_CODENAME" ]] || fail "The distribution codename is missing from /etc/os-release."
}

install_apt_package() {
  local package_name="$1"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y "$package_name"
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then
    return
  fi
  read_os_release
  log "Installing Git"
  install_apt_package git
}

acquire_repository() {
  local destination_parent

  if [[ -n "$SOURCE_DIRECTORY" ]]; then
    SOURCE_DIRECTORY="$(cd "$SOURCE_DIRECTORY" >/dev/null 2>&1 && pwd)"
    repository_is_valid "$SOURCE_DIRECTORY" || fail "The source directory is not a complete Badaction checkout: $SOURCE_DIRECTORY"
    return
  fi
  detect_embedded_repository
  if [[ -n "$SOURCE_DIRECTORY" ]]; then
    SOURCE_DIRECTORY="$(cd "$SOURCE_DIRECTORY" >/dev/null 2>&1 && pwd)"
    repository_is_valid "$SOURCE_DIRECTORY" || fail "The source directory is not a complete Badaction checkout: $SOURCE_DIRECTORY"
    return
  fi

  ensure_git
  if [[ -e "$INSTALL_DIRECTORY" ]]; then
    repository_is_valid "$INSTALL_DIRECTORY" || fail "$INSTALL_DIRECTORY already exists but is not a complete guided-install checkout. Move it aside or select --install-dir."
    SOURCE_DIRECTORY="$(cd "$INSTALL_DIRECTORY" >/dev/null 2>&1 && pwd)"
    return
  fi

  destination_parent="$(dirname "$INSTALL_DIRECTORY")"
  install -d -m 755 "$destination_parent"
  log "Downloading Badaction into $INSTALL_DIRECTORY"
  git clone --depth 1 --branch "$REPOSITORY_REF" -- "$REPOSITORY_URL" "$INSTALL_DIRECTORY"
  SOURCE_DIRECTORY="$(cd "$INSTALL_DIRECTORY" >/dev/null 2>&1 && pwd)"
  repository_is_valid "$SOURCE_DIRECTORY" || fail "The downloaded revision does not contain the guided installer files."
}

docker_is_ready() {
  command -v docker >/dev/null 2>&1 \
    && docker compose version >/dev/null 2>&1 \
    && docker compose up --help 2>/dev/null | grep -q -- '--wait' \
    && docker info >/dev/null 2>&1
}

installed_conflicting_docker_packages() {
  local package_name
  local installed=()

  command -v dpkg-query >/dev/null 2>&1 || return 0
  for package_name in docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc; do
    if dpkg-query -W -f='${db:Status-Abbrev}' "$package_name" 2>/dev/null | grep -q '^ii'; then
      installed+=("$package_name")
    fi
  done
  if [[ ${#installed[@]} -gt 0 ]]; then
    printf '%s\n' "${installed[*]}"
  fi
}

install_docker() {
  local conflicts
  local keyring_temp
  local architecture

  if docker_is_ready; then
    return
  fi
  if [[ "$SKIP_DOCKER_INSTALL" == "1" ]]; then
    fail "Docker Engine with a current Compose v2 (including --wait) is not ready and automatic installation was disabled."
  fi
  if command -v docker >/dev/null 2>&1; then
    fail "Docker is installed, but the daemon or a current Compose v2 with --wait support is unavailable. Fix or update the existing installation before continuing."
  fi

  read_os_release
  conflicts="$(installed_conflicting_docker_packages)"
  if [[ -n "$conflicts" ]]; then
    fail "Conflicting container packages are installed: $conflicts. Review Docker's official uninstall guidance; the Badaction installer will not remove existing software automatically."
  fi
  confirm "Install Docker Engine from Docker's official apt repository?" || fail "Docker installation was declined."

  log "Installing Docker Engine and Compose v2"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl
  install -d -m 0755 /etc/apt/keyrings
  keyring_temp="$(mktemp /tmp/badaction-docker-key.XXXXXX)"
  if ! curl --fail --show-error --silent --location \
    "https://download.docker.com/linux/${INSTALLER_OS_ID}/gpg" \
    --output "$keyring_temp"; then
    rm -f -- "$keyring_temp"
    fail "Could not download Docker's official apt signing key."
  fi
  install -m 0644 "$keyring_temp" /etc/apt/keyrings/docker.asc
  rm -f -- "$keyring_temp"
  architecture="$(dpkg --print-architecture)"
  {
    printf 'Types: deb\n'
    printf 'URIs: https://download.docker.com/linux/%s\n' "$INSTALLER_OS_ID"
    printf 'Suites: %s\n' "$INSTALLER_OS_CODENAME"
    printf 'Components: stable\n'
    printf 'Architectures: %s\n' "$architecture"
    printf 'Signed-By: /etc/apt/keyrings/docker.asc\n'
  } >/etc/apt/sources.list.d/docker.sources
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker
  fi
  docker_is_ready || fail "Docker was installed but did not become ready. Check: systemctl status docker"
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi
  command -v od >/dev/null 2>&1 || fail "openssl or od is required to generate secure secrets."
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

generate_unique_secret() {
  local candidate
  local existing
  local duplicate

  while true; do
    candidate="$(generate_secret)"
    duplicate=0
    for existing in "$@"; do
      if [[ "$candidate" == "$existing" ]]; then
        duplicate=1
        break
      fi
    done
    if [[ "$duplicate" == "0" ]]; then
      printf '%s' "$candidate"
      return
    fi
  done
}

port_is_listening() {
  local port="$1"
  command -v ss >/dev/null 2>&1 || return 1
  ss -H -ltn | awk '{ print $4 }' | grep -Eq ":${port}$"
}

choose_loopback_port() {
  local preferred="$1"
  local fallback_start="$2"
  local candidate

  if ! port_is_listening "$preferred"; then
    printf '%s' "$preferred"
    return
  fi
  candidate="$fallback_start"
  while [[ "$candidate" -le 65535 ]]; do
    if ! port_is_listening "$candidate"; then
      printf '%s' "$candidate"
      return
    fi
    candidate=$((candidate + 1))
  done
  fail "Could not find a free loopback port."
}

generate_environment() {
  local target_file="$1"
  local target_directory
  local temporary_file
  local postgres_admin_password
  local postgres_migrator_password
  local postgres_runtime_password
  local visitor_secret
  local board_secret
  local rate_limit_secret
  local app_port
  local postgres_port

  [[ ! -e "$target_file" && ! -L "$target_file" ]] || fail "Refusing to overwrite existing environment file: $target_file"
  target_directory="$(dirname "$target_file")"
  umask 077

  postgres_admin_password="$(generate_unique_secret)"
  postgres_migrator_password="$(generate_unique_secret "$postgres_admin_password")"
  postgres_runtime_password="$(generate_unique_secret "$postgres_admin_password" "$postgres_migrator_password")"
  visitor_secret="$(generate_unique_secret "$postgres_admin_password" "$postgres_migrator_password" "$postgres_runtime_password")"
  board_secret="$(generate_unique_secret "$postgres_admin_password" "$postgres_migrator_password" "$postgres_runtime_password" "$visitor_secret")"
  rate_limit_secret="$(generate_unique_secret "$postgres_admin_password" "$postgres_migrator_password" "$postgres_runtime_password" "$visitor_secret" "$board_secret")"
  app_port="$(choose_loopback_port 3000 3100)"
  postgres_port="$(choose_loopback_port 5432 55432)"
  temporary_file="$(mktemp "$target_directory/.env.production.tmp.XXXXXX")"

  if ! {
    printf '# Generated by deploy/install.sh. Keep this file private and back it up securely.\n'
    printf 'BADACTION_INSTALLER_MANAGED=1\n'
    printf 'COMPOSE_PROJECT_NAME=badaction-production\n\n'
    printf 'POSTGRES_DB=retro\n'
    printf 'POSTGRES_USER=badaction_admin\n'
    printf 'POSTGRES_PASSWORD=%s\n' "$postgres_admin_password"
    printf 'POSTGRES_MIGRATOR_USER=badaction_migrator\n'
    printf 'POSTGRES_MIGRATOR_PASSWORD=%s\n' "$postgres_migrator_password"
    printf 'POSTGRES_RUNTIME_USER=badaction_app\n'
    printf 'POSTGRES_RUNTIME_PASSWORD=%s\n\n' "$postgres_runtime_password"
    printf 'DOCKER_MIGRATOR_DATABASE_URL=postgresql://badaction_migrator:%s@postgres:5432/retro?schema=public\n' "$postgres_migrator_password"
    printf 'DOCKER_RUNTIME_DATABASE_URL=postgresql://badaction_app:%s@postgres:5432/retro?schema=public\n\n' "$postgres_runtime_password"
    printf 'DOCKER_VISITOR_TOKEN_SECRET=%s\n' "$visitor_secret"
    printf 'DOCKER_BOARD_ACCESS_SECRET=%s\n' "$board_secret"
    printf 'DOCKER_RATE_LIMIT_KEY_SECRET=%s\n' "$rate_limit_secret"
    printf 'DOCKER_APP_ORIGIN=https://%s\n\n' "$DOMAIN"
    printf 'BADACTION_DOMAIN=%s\n' "$DOMAIN"
    printf 'CADDY_ACME_EMAIL=%s\n\n' "$ACME_EMAIL"
    printf 'APP_PORT=%s\n' "$app_port"
    printf 'POSTGRES_PORT=%s\n' "$postgres_port"
    printf 'TRUSTED_PROXY_HOPS=1\n\n'
    printf 'BOARD_RETENTION_DAYS=90\n'
    printf 'BOARD_CARD_LIMIT=500\n'
    printf 'RETENTION_CLEANUP_ENABLED=true\n'
    printf 'RETENTION_CLEANUP_INTERVAL_MINUTES=60\n'
    printf 'RETENTION_CLEANUP_BATCH_SIZE=1000\n'
  } >"$temporary_file"; then
    rm -f -- "$temporary_file"
    fail "Could not write the protected production environment."
  fi
  if ! chmod 600 "$temporary_file" || ! mv -- "$temporary_file" "$target_file"; then
    rm -f -- "$temporary_file"
    fail "Could not install the protected production environment."
  fi
}

read_environment_value() {
  local environment_file="$1"
  local variable_name="$2"
  awk -F= -v name="$variable_name" '$1 == name { print substr($0, length(name) + 2); exit }' "$environment_file"
}

validate_existing_environment() {
  local environment_file="$1"
  local configured_domain
  local configured_email
  local variable_name
  local value
  local postgres_admin_password
  local postgres_migrator_password
  local postgres_runtime_password
  local visitor_secret
  local board_secret
  local rate_limit_secret

  [[ "$(read_environment_value "$environment_file" BADACTION_INSTALLER_MANAGED)" == "1" ]] || fail "An existing .env.production was not created by this installer. It was left unchanged; use the advanced deployment guide or a fresh checkout."
  configured_domain="$(read_environment_value "$environment_file" BADACTION_DOMAIN)"
  configured_email="$(read_environment_value "$environment_file" CADDY_ACME_EMAIL)"
  [[ -n "$configured_domain" && -n "$configured_email" ]] || fail "The installer-managed environment is incomplete. Restore its protected backup before continuing."
  is_valid_domain "$configured_domain" || fail "The installer-managed domain is invalid. Restore or repair the protected environment deliberately."
  is_valid_email "$configured_email" || fail "The installer-managed TLS email is invalid. Restore or repair the protected environment deliberately."

  if [[ -n "$DOMAIN" ]]; then
    DOMAIN="$(normalize_domain "$DOMAIN")"
    is_valid_domain "$DOMAIN" || fail "Use a DNS hostname without https://, a port, a path, or a trailing slash."
  fi
  if [[ -n "$DOMAIN" && "$DOMAIN" != "$configured_domain" ]]; then
    fail "The existing installation uses $configured_domain. Domain changes require a reviewed configuration change."
  fi
  if [[ -n "$ACME_EMAIL" && "$ACME_EMAIL" != "$configured_email" ]]; then
    fail "The existing installation uses a different TLS email. Edit the protected environment deliberately before rerunning."
  fi
  DOMAIN="$configured_domain"
  ACME_EMAIL="$configured_email"

  for variable_name in POSTGRES_PASSWORD POSTGRES_MIGRATOR_PASSWORD POSTGRES_RUNTIME_PASSWORD DOCKER_VISITOR_TOKEN_SECRET DOCKER_BOARD_ACCESS_SECRET DOCKER_RATE_LIMIT_KEY_SECRET; do
    value="$(read_environment_value "$environment_file" "$variable_name")"
    [[ ${#value} -ge 32 ]] || fail "The installer-managed environment is missing a required strong value: $variable_name"
  done
  postgres_admin_password="$(read_environment_value "$environment_file" POSTGRES_PASSWORD)"
  postgres_migrator_password="$(read_environment_value "$environment_file" POSTGRES_MIGRATOR_PASSWORD)"
  postgres_runtime_password="$(read_environment_value "$environment_file" POSTGRES_RUNTIME_PASSWORD)"
  visitor_secret="$(read_environment_value "$environment_file" DOCKER_VISITOR_TOKEN_SECRET)"
  board_secret="$(read_environment_value "$environment_file" DOCKER_BOARD_ACCESS_SECRET)"
  rate_limit_secret="$(read_environment_value "$environment_file" DOCKER_RATE_LIMIT_KEY_SECRET)"
  [[ "$postgres_admin_password" != "$postgres_migrator_password" \
    && "$postgres_admin_password" != "$postgres_runtime_password" \
    && "$postgres_migrator_password" != "$postgres_runtime_password" ]] || fail "The installer-managed PostgreSQL passwords must remain distinct."
  [[ "$visitor_secret" != "$board_secret" \
    && "$visitor_secret" != "$rate_limit_secret" \
    && "$board_secret" != "$rate_limit_secret" ]] || fail "The installer-managed application secrets must remain distinct."
  [[ "$(read_environment_value "$environment_file" DOCKER_MIGRATOR_DATABASE_URL)" == "postgresql://badaction_migrator:${postgres_migrator_password}@postgres:5432/retro?schema=public" ]] || fail "The installer-managed migrator database URL does not match its generated credentials."
  [[ "$(read_environment_value "$environment_file" DOCKER_RUNTIME_DATABASE_URL)" == "postgresql://badaction_app:${postgres_runtime_password}@postgres:5432/retro?schema=public" ]] || fail "The installer-managed runtime database URL does not match its generated credentials."
  [[ "$(read_environment_value "$environment_file" DOCKER_APP_ORIGIN)" == "https://$DOMAIN" ]] || fail "DOCKER_APP_ORIGIN does not match the installer-managed domain."
  chmod 600 "$environment_file"
}

ensure_fresh_compose_namespace() {
  local existing_containers
  local resource_name

  existing_containers="$(docker ps --all --filter label=com.docker.compose.project=badaction-production --format '{{.Names}}')"
  if [[ -n "$existing_containers" ]]; then
    fail "A Docker Compose project named badaction-production already has containers, but this checkout has no installer-managed environment. Existing containers: $existing_containers"
  fi
  for resource_name in \
    badaction-production_postgres-data \
    badaction-production_caddy-data \
    badaction-production_caddy-config; do
    if docker volume inspect "$resource_name" >/dev/null 2>&1; then
      fail "Docker volume $resource_name already exists, but this checkout has no installer-managed environment. The installer will not attach new credentials to possibly valuable data."
    fi
  done
  if docker network inspect badaction-production_default >/dev/null 2>&1; then
    fail "Docker network badaction-production_default already exists, but this checkout has no installer-managed environment. Resolve the existing installation before continuing."
  fi
}

check_resources() {
  local available_kilobytes
  local memory_kilobytes

  available_kilobytes="$(df -Pk "$SOURCE_DIRECTORY" | awk 'NR == 2 { print $4 }')"
  if [[ "$available_kilobytes" =~ ^[0-9]+$ && "$available_kilobytes" -lt 5242880 ]]; then
    warn "Less than 5 GB is free. Image builds, PostgreSQL, and backups may fill the disk."
  fi
  if [[ -r /proc/meminfo ]]; then
    memory_kilobytes="$(awk '/^MemTotal:/ { print $2; exit }' /proc/meminfo)"
    if [[ "$memory_kilobytes" =~ ^[0-9]+$ && "$memory_kilobytes" -lt 1900000 ]]; then
      warn "Less than 2 GB RAM is available. The production image build may need swap or a larger server."
    fi
  fi
}

check_dns() {
  local addresses

  if [[ "$SKIP_DNS_CHECK" == "1" ]]; then
    warn "DNS resolution check was skipped. Automatic HTTPS will fail until the domain reaches this server."
    return
  fi
  command -v getent >/dev/null 2>&1 || fail "getent is required for the DNS preflight, or pass --skip-dns-check after verifying DNS yourself."
  addresses="$(getent ahosts "$DOMAIN" 2>/dev/null | awk '{ print $1 }' | sort -u)"
  [[ -n "$addresses" ]] || fail "$DOMAIN does not resolve yet. Create its A record (and AAAA only when IPv6 works), wait for DNS, and retry."
  printf 'DNS currently resolves %s to:\n%s\n' "$DOMAIN" "$addresses"
  confirm "Do these records route to this server, with TCP ports 80 and 443 open?" || fail "Correct DNS or firewall rules, then retry."
}

compose() {
  local environment_file="$SOURCE_DIRECTORY/.env.production"
  docker compose \
    --env-file "$environment_file" \
    -f "$SOURCE_DIRECTORY/docker-compose.yml" \
    -f "$SOURCE_DIRECTORY/docker-compose.production.yml" \
    -f "$SOURCE_DIRECTORY/docker-compose.quick-start.yml" \
    --profile app \
    "$@"
}

guided_caddy_is_running() {
  compose ps --status running --services 2>/dev/null | grep -qx caddy
}

check_public_ports() {
  if guided_caddy_is_running; then
    return
  fi
  if port_is_listening 80 || port_is_listening 443; then
    if command -v ss >/dev/null 2>&1; then
      ss -ltn '( sport = :80 or sport = :443 )' >&2 || true
    fi
    fail "TCP port 80 or 443 is already in use. Stop or reconfigure the existing web server before starting Caddy."
  fi
}

install_management_command() {
  local target="/usr/local/bin/badaction"
  local source="$SOURCE_DIRECTORY/deploy/manage.sh"

  if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
    return
  fi
  if [[ -e "$target" || -L "$target" ]]; then
    warn "$target already exists, so it was not replaced. Use: sudo $source"
    return
  fi
  ln -s "$source" "$target"
}

start_stack() {
  log "Validating the generated configuration"
  compose config --quiet
  log "Building and starting Badaction, PostgreSQL, and automatic HTTPS"
  compose up --detach --build --wait --wait-timeout 300
}

verify_health() {
  local app_port
  local attempt

  command -v curl >/dev/null 2>&1 || return
  app_port="$(read_environment_value "$SOURCE_DIRECTORY/.env.production" APP_PORT)"
  curl --fail --show-error --silent "http://127.0.0.1:${app_port}/api/health" >/dev/null

  for attempt in 1 2 3 4 5 6; do
    if curl --fail --show-error --silent --max-time 10 "https://${DOMAIN}/api/health" >/dev/null 2>&1; then
      printf 'Public HTTPS health check passed.\n'
      return
    fi
    if [[ "$attempt" -lt 6 ]]; then
      printf 'Waiting for DNS and the TLS certificate (%s/6)...\n' "$attempt"
      sleep 5
    fi
  done
  warn "The local application is healthy, but public HTTPS is not ready yet. Run 'sudo badaction logs caddy' and 'sudo badaction doctor' after DNS reaches this server."
}

print_dry_run() {
  cat <<EOF
Dry run passed. The real installation will:
  1. use or download the reviewed source into $INSTALL_DIRECTORY;
  2. install Docker Engine and Compose v2 when they are missing;
  3. generate six independent secrets in a mode-600 .env.production file;
  4. build and start PostgreSQL, migrations, Badaction, and Caddy;
  5. request an HTTPS certificate for https://$DOMAIN using $ACME_EMAIL;
  6. install the 'badaction' management command.

No files or services were changed.
EOF
}

main() {
  local environment_file
  local fresh_installation=0

  parse_arguments "$@"
  require_root
  if [[ "$DRY_RUN" == "1" ]]; then
    collect_input
    print_dry_run
    return
  fi

  acquire_repository
  environment_file="$SOURCE_DIRECTORY/.env.production"
  if [[ -e "$environment_file" || -L "$environment_file" ]]; then
    validate_existing_environment "$environment_file"
    log "Reusing the existing protected environment and secrets"
  else
    collect_input
    check_dns
    fresh_installation=1
  fi

  check_resources
  install_docker
  if [[ "$fresh_installation" == "1" ]]; then
    ensure_fresh_compose_namespace
    log "Generating independent database passwords and application secrets"
    generate_environment "$environment_file"
  fi
  check_public_ports
  start_stack
  install_management_command
  verify_health

  cat <<EOF

Installation complete.

Public URL:  https://$DOMAIN
Source:      $SOURCE_DIRECTORY
Secrets:     $environment_file (mode 600; never publish it)

Useful commands:
  sudo badaction doctor
  sudo badaction status
  sudo badaction logs
  sudo badaction backup

Create a disposable board and test an invitation in a private browser window.
Then configure encrypted off-server backups. See docs/quick-start.md for the
post-install checklist and docs/operations.md for backup and update procedures.
EOF
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
