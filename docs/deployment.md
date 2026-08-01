[English](deployment.md) | [Русский](ru/deployment.md) | [Español](es/deployment.md)

# Deployment

This repository provides a Docker Compose baseline for one Linux host. It builds
separate migration and application images, starts PostgreSQL 16, runs forward
Prisma migrations, and binds the database and application ports to loopback.

It is not a complete managed production platform. Before serving real teams,
the operator must provide DNS, HTTPS termination, a correctly configured reverse
proxy, backups and restore drills, monitoring, secret management, and host and
database security. The included named volume is persistence, not a backup or a
high-availability design.

## Prerequisites

- A reviewed Badaction source revision.
- Docker with BuildKit and the Compose v2 command (`docker compose`). The
  project does not declare a minimum Docker or Compose version.
- Enough host storage for images, PostgreSQL data, and separate backups.
- A DNS name and a reverse proxy that terminates HTTPS.
- Six independently generated credentials: three PostgreSQL role passwords and
  three application HMAC secrets.
- A tested backup destination and an operator who can restore PostgreSQL 16.

The bundled migration chain supports PostgreSQL 16 in the `public` schema.
Other PostgreSQL major versions and alternate schemas are not supported.

## Prepare the environment

Copy the production template to an ignored file and restrict its permissions:

```bash
cp deploy/production.env.example .env.production
chmod 600 .env.production
```

Generate a fresh value six times and store each result separately:

```bash
openssl rand -hex 32
```

Edit `.env.production` and set all blank fields. In particular:

- `POSTGRES_PASSWORD`, `POSTGRES_MIGRATOR_PASSWORD`, and
  `POSTGRES_RUNTIME_PASSWORD` must be different; the associated admin,
  migrator, and runtime role names must also remain distinct and match
  `[a-z_][a-z0-9_]{0,62}`;
- `DOCKER_MIGRATOR_DATABASE_URL` must use the migrator role, while
  `DOCKER_RUNTIME_DATABASE_URL` must use the runtime role. Both use the Compose
  service hostname `postgres`, for example
  `postgresql://badaction_app:HEX_PASSWORD@postgres:5432/retro?schema=public`;
- `DOCKER_VISITOR_TOKEN_SECRET`, `DOCKER_BOARD_ACCESS_SECRET`, and
  `DOCKER_RATE_LIMIT_KEY_SECRET` must be different, non-placeholder values of
  at least 32 characters;
- `DOCKER_APP_ORIGIN` must be the exact public HTTPS origin, without a trailing
  slash, path, query, or fragment, for example `https://retro.example.com`.

Hex-generated passwords need no URL encoding. If a database password contains
reserved URL characters, percent-encode it in each affected database URL.
Never commit `.env.production`, copy it into an image, or print its expanded
Compose configuration in a public log.

`COMPOSE_PROJECT_NAME=badaction-production` keeps this stack and its named
volume separate from the local quick start. On the first start of an empty
volume, `deploy/init-production-db.sh` creates distinct non-superuser migrator
and runtime roles. The migration chain issues `CREATE SCHEMA IF NOT EXISTS
public`, so the migrator receives `CREATE` on the database and creates and owns
objects in `public`; the application must never use that role. The runtime role
cannot create schemas or schema objects. PostgreSQL initialization scripts do
not run again for an existing volume. For an existing installation, provision
and grant the roles through a reviewed database change and update the two
URLs—do not change the project name or delete the volume as a shortcut.

The base `docker-compose.yml` contains predictable local-development defaults.
Always include `docker-compose.production.yml` for a shared or public instance;
the override makes the database URL, public origin, and credentials mandatory.

Validate interpolation before building:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  config --quiet
```

`config --quiet` checks Compose syntax and required interpolation. Runtime
validation still happens in the application: it checks the origin, secret
quality, numeric ranges, and database reachability. See
[Configuration](configuration.md) for every setting and rotation consequence.

## Build and start

Build both artifacts from the reviewed checkout:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  build migrate app
```

Then start the stack and wait for the application healthcheck:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  up --detach --wait --wait-timeout 240
```

PostgreSQL must become healthy first. The one-shot `migrate` container then
runs `prisma migrate deploy`; the non-root `app` container starts only after
migrations complete successfully. Inspect the effective state without exposing
environment values:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  ps

docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  logs --tail 100 migrate app postgres
```

Logs can still contain operational metadata. Do not publish logs containing
board content, cookies, database URLs, invitation fragments, or owner-claim
URLs.

The optional `DOCKER_RUNNER_IMAGE` and `DOCKER_MIGRATOR_IMAGE` settings select
prebuilt images. Set both to artifacts from the same reviewed source and
migration set, preferably immutable digest references. Do not mix an
application image with a migrator from another version. When using prebuilt
images, pull and test them through your own supply-chain process and start with
`--no-build` rather than rebuilding under the supplied reference.

## HTTPS reverse proxy and SSE

Compose publishes the application as `127.0.0.1:${APP_PORT}:3000`. A reverse
proxy on the same host can send public HTTPS traffic to that loopback address.
If the proxy runs on another host or in another container network, this
baseline needs an explicit networking change; do not expose the Node port
directly to the internet.

Set the usual trusted forwarding headers for all requests. For the board event
route, preserve streaming semantics:

- use HTTP/1.1 or newer to the upstream;
- disable response buffering, caching, compression, and transformations;
- keep the upstream connection open with a read timeout longer than the
  12-second heartbeat;
- pass disconnects promptly so the server can release stream capacity.

The application already returns `text/event-stream`, `Cache-Control: no-store,
no-transform`, `Connection: keep-alive`, and `X-Accel-Buffering: no`. Proxy
configuration remains necessary. This Nginx fragment illustrates the required
behavior and must be integrated with the operator's TLS and security policy:

```nginx
location ~ ^/api/boards/[0-9a-f-]+/events$ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Accept-Encoding "";
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;
}
```

The client also reconciles authoritative board state every 30 seconds, and the
server rechecks stream access every 30 seconds. That fallback reduces the
impact of a transient SSE failure but does not make a broken proxy or listener
configuration acceptable.

`TRUSTED_PROXY_HOPS` controls only which `X-Forwarded-For` address may be used
for secondary abuse limits. Keep it at `0` unless every hop at the configured
trust boundary is controlled and documented. For a direct Nginx-to-app path,
`1` is normally the proxy boundary; additional load balancers change that
number. An incorrect positive value can trust attacker-supplied addresses or
group unrelated clients.

## PostgreSQL connection semantics

The application uses the same `DATABASE_URL` for three kinds of access:

- the Prisma pool used for requests and migrations;
- one persistent `pg` session per application process after its first realtime
  stream, used for PostgreSQL `LISTEN`;
- a temporary `pg` session during each retention-cleanup attempt, used to hold
  an advisory lock.

Use a direct PostgreSQL connection or a pooler that preserves session affinity.
Transaction-only pooling is incompatible with both `LISTEN` and the cleanup
lock. A successful `/api/health` response does not prove that these session
features work, because the health endpoint performs only a short `SELECT 1`.

Budget database connections for every application replica: each has its own
Prisma pool and realtime listener, and cleanup briefly adds another session.
The repository does not set a universal Prisma pool size because capacity
depends on the host and database. Test the complete board flow under the chosen
connection topology before exposing it.

## Verify the deployment

First query the loopback endpoint from the host:

```bash
curl --fail --show-error --silent http://127.0.0.1:3000/api/health
```

After DNS and TLS are active, query the public endpoint and verify the
certificate:

```bash
curl --fail --show-error --silent https://retro.example.com/api/health
```

A healthy response is `{"status":"ok"}`. It means runtime configuration parsed,
the process is not draining, and a 1.5-second database probe succeeded. It does
not verify migration status, realtime delivery, cleanup progress, backups,
proxy buffering, available storage, or the public board workflow.

Complete a disposable functional check through the public origin:

1. Create a board in one browser profile.
2. Redeem a participant invitation in a separate profile.
3. Confirm updates arrive in both profiles without a manual reload.
4. Exercise a mutation and an export.
5. Delete the disposable board from the owner profile.

Do not record invitation URLs, cookies, or board content while testing. Monitor
application and PostgreSQL logs and confirm the retention-cleanup event output.

## Shutdown and deployment limits

Use Compose to send the application `SIGTERM` instead of killing the process:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  stop app
```

During shutdown the application marks health unavailable, cancels or waits for
cleanup, and closes the PostgreSQL listener. Its internal lifecycle deadline is
25 seconds, the supervisor preparation deadline is 30 seconds, and Compose
allows 60 seconds before forcing termination. Give another orchestrator at
least the same grace period. A repeated termination signal can force a kill.

The included setup is a single-host starting point. It does not provide
automatic failover, rolling deployments, zero-downtime schema changes,
certificate automation, remote backups, centralized logs, metrics, alerts,
resource limits, or a global SSE connection cap. Multiple replicas can share a
database and coordinate embedded cleanup, but they multiply connection usage
and local stream limits; design and test ingress limits and update sequencing
before scaling out.

Use [Operations](operations.md) for backup, restore, forward migration,
retention, health, and owner-recovery procedures. Use
[Troubleshooting](troubleshooting.md) when startup, database, or realtime checks
fail.
