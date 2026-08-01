[English](configuration.md) | [Русский](ru/configuration.md) | [Español](es/configuration.md)

# Configuration

Badaction reads runtime settings from environment variables. Source
development commonly loads an ignored `.env` copied from `.env.example`.
Docker Compose reads host-side variables and maps its `DOCKER_*` values to the
runtime names inside the application and migrator containers.

Never commit real environment files. Use a secret manager or an operator-owned
file with restrictive permissions, and do not print expanded environment
values in CI or support logs.

## Runtime settings

The following settings are read by the Node application.

| Variable                             | Required   | Default                                                  | Purpose                                                                                                                                                | Security notes                                                                                                                                     |
| ------------------------------------ | ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                       | Yes        | None                                                     | Connects Prisma, migrations, realtime, and cleanup to PostgreSQL 16. The supported schema is `public`; use `?schema=public`.                           | Treat the complete URL as a secret. It must provide session semantics; transaction-only pooling breaks realtime and cleanup locking.               |
| `APP_ORIGIN`                         | Production | In non-production, inferred from the request when absent | Defines the exact canonical browser origin used for mutation checks and generated owner-claim URLs.                                                    | Production requires HTTPS. Credentials, paths, queries, fragments, and a trailing slash are rejected; plain HTTP is accepted only for `localhost`. |
| `VISITOR_TOKEN_SECRET`               | Production | Built-in development fallback outside production         | Signs the visitor cookie and derives board-scoped vote identity.                                                                                       | Use an independent non-placeholder value of at least 32 characters. Rotation invalidates cookies and changes vote identity.                        |
| `BOARD_ACCESS_SECRET`                | Production | Built-in development fallback outside production         | Derives anonymous-session and invitation hashes.                                                                                                       | Use an independent non-placeholder value of at least 32 characters. Rotation breaks resolution of existing access and invitations.                 |
| `RATE_LIMIT_KEY_SECRET`              | Production | Built-in development fallback outside production         | Derives database-backed visitor and trusted-IP rate-limit keys.                                                                                        | Use an independent non-placeholder value of at least 32 characters. Rotation resets continuity with existing rate-limit buckets.                   |
| `TRUSTED_PROXY_HOPS`                 | No         | `0`; integer `0`–`10`                                    | Selects the trusted `X-Forwarded-For` boundary for secondary IP abuse limits. At `0`, visitor limits still apply but forwarded IP is ignored.          | Set a positive value only for a controlled, documented proxy chain; a wrong boundary can trust attacker input or group unrelated clients.          |
| `BOARD_RETENTION_DAYS`               | No         | `90`; integer `1`–`365`                                  | Sets `expiresAt` when a new board is created. Changing it does not rewrite existing board expiry times.                                                | Shorter retention limits live data exposure, but backups and infrastructure logs need separate deletion policies.                                  |
| `BOARD_CARD_LIMIT`                   | No         | `500`; integer `1`–`10000`                               | Limits cards on a board and bounds export work. Lowering it below existing data can block new cards and make an over-limit export fail.                | Choose a bounded value appropriate for database and request capacity; do not use it as a substitute for ingress abuse controls.                    |
| `RETENTION_CLEANUP_ENABLED`          | No         | `true`; exactly `true`, `false`, `1`, or `0`             | Enables the cleanup scheduler embedded in each Node application process.                                                                               | If disabled, a monitored external cleanup schedule is mandatory to enforce physical deletion.                                                      |
| `RETENTION_CLEANUP_INTERVAL_MINUTES` | No         | `60`; integer `1`–`1440`                                 | Sets the delay between embedded cleanup attempts and the database-coordinated minimum interval across replicas. Cleanup also attempts once at startup. | Balance deletion delay and database load; alert on missing or failed runs rather than assuming the configured cadence succeeded.                   |
| `RETENTION_CLEANUP_BATCH_SIZE`       | No         | `1000`; integer `1`–`10000`                              | Bounds candidate and bulk work in one cleanup pass; board children are also deleted in internal chunks.                                                | Larger batches can increase database load and lock pressure. Measure on production-sized restored data before increasing it.                       |
| `NEXT_TELEMETRY_DISABLED`            | No         | `1` in Docker build and runtime images                   | Disables Next.js telemetry when set to `1` during a source build or source runtime.                                                                    | Keep it set as shown when the deployment policy forbids framework telemetry.                                                                       |

`NODE_ENV`, `PORT`, and `HOSTNAME` are process/platform settings rather than
Badaction product configuration. The runner image fixes them to `production`,
`3000`, and `0.0.0.0`. Change the Compose host mapping with `APP_PORT`; do not
change the container port unless you also customize the image and healthchecks.
`NEXT_RUNTIME` and `NEXT_PHASE` are supplied by Next.js and must not be set by
an operator.

### Canonical origin

`APP_ORIGIN` is authoritative for mutation-origin checks and generated owner
claim URLs. Exact means that scheme, host, and explicit non-default port must
match the browser's `Origin` header. These are different origins:

```text
https://retro.example.com
https://retro.example.com:8443
http://localhost:3000
http://127.0.0.1:3000
```

Only the `localhost` HTTP form is accepted, and only for local use. A reverse
proxy cannot compensate for an incorrect `APP_ORIGIN`; set the public HTTPS
origin directly.

### Database URL and schema

The migrations, Prisma queries, raw cleanup queries, advisory lock, and
`LISTEN/NOTIFY` path are tested with PostgreSQL 16 and the `public` schema. A
typical production runtime URL is:

```text
postgresql://badaction_app:URL_ENCODED_PASSWORD@postgres:5432/retro?schema=public
```

The `postgres` hostname is valid inside the Compose network. A host-side source
process normally uses `localhost` and `POSTGRES_PORT` instead. If an external
provider requires TLS, add the provider's supported SSL parameters and verify
both Prisma and the realtime listener. Do not use a transaction-only pooler:
`LISTEN` and advisory locks need persistent sessions.

The production Compose baseline uses a separate migrator URL. Its role may
create and alter objects in `public`; the long-running application role receives
only the data privileges needed by the current schema. Keep the two URLs,
passwords, and roles distinct.

Alternate PostgreSQL schemas are not supported by the current operational
queries. Changing only the Prisma `schema` query parameter is insufficient.

### Application secrets and rotation

Generate each application secret independently, for example with
`openssl rand -hex 32`. In production, the runtime validates length and common
placeholder markers and rejects equality between the three configured values.

There is no built-in dual-key rotation. Treat a direct change as an incident or
coordinated data migration:

- rotating `VISITOR_TOKEN_SECRET` invalidates existing visitor cookies and
  changes board-scoped vote identities; existing vote rows remain, but browsers
  no longer present the prior identity;
- rotating `BOARD_ACCESS_SECRET` changes session and invitation hashes, so
  existing memberships and raw invitation tokens cannot be resolved from their
  current browser credentials;
- rotating `RATE_LIMIT_KEY_SECRET` changes the rate-limit key namespace and
  effectively discards continuity with existing buckets.

Back up the database, define user recovery and rollback, and test rotation on a
restored copy before changing any of these values. Losing the current values
has the same consequences as rotating them.

## Docker Compose settings

The base Compose file is for loopback development. The production override and
`deploy/production.env.example` require operator values for shared or public
use.

| Variable                       | Base default               | Production behavior                  | Effect                                                                                                                                                        |
| ------------------------------ | -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPOSE_PROJECT_NAME`         | Directory-derived          | Template: `badaction-production`     | Gives the production stack and its named volume a stable namespace separate from the local quick start.                                                       |
| `POSTGRES_DB`                  | `retro`                    | Optional; the template sets `retro`  | Database created by the PostgreSQL image when the volume is empty.                                                                                            |
| `POSTGRES_USER`                | `postgres`                 | Required by the production override  | Administrative role created by the PostgreSQL image on an empty volume. The application does not use it.                                                      |
| `POSTGRES_PASSWORD`            | `postgres`                 | Required by the production override  | Initial password for the administrative `POSTGRES_USER`; production initialization requires at least 32 characters.                                           |
| `POSTGRES_MIGRATOR_USER`       | None                       | Required by the production override  | Non-superuser role created on an empty volume with database `CREATE` so the migration chain can create `public`; it creates and owns migration objects there. |
| `POSTGRES_MIGRATOR_PASSWORD`   | None                       | Required by the production override  | Password for the migrator role; at least 32 characters and distinct from the admin and runtime passwords.                                                     |
| `POSTGRES_RUNTIME_USER`        | None                       | Required by the production override  | Non-superuser role created on an empty volume with data access but without schema-creation privileges.                                                        |
| `POSTGRES_RUNTIME_PASSWORD`    | None                       | Required by the production override  | Password for the long-running application role; at least 32 characters and distinct from the admin and migrator passwords.                                    |
| `POSTGRES_PORT`                | `5432`                     | Optional                             | Publishes PostgreSQL as `127.0.0.1:<value>`. It does not change the internal port `5432`.                                                                     |
| `APP_PORT`                     | `3000`                     | Optional                             | Publishes the application as `127.0.0.1:<value>`. It does not change the internal port `3000`.                                                                |
| `DOCKER_DATABASE_URL`          | Predictable local URL      | Not used by the production override  | Passed to both containers only by the loopback development Compose file.                                                                                      |
| `DOCKER_MIGRATOR_DATABASE_URL` | None                       | Required by the production override  | Passed to the one-shot migrator as `DATABASE_URL`; use the migrator role and `postgres:5432` for the bundled service.                                         |
| `DATABASE_RUNTIME_ROLE`        | None                       | Derived from `POSTGRES_RUNTIME_USER` | Internal migrator setting: validates the runtime role name and revokes its access to `_prisma_migrations` after a deploy.                                     |
| `DOCKER_RUNTIME_DATABASE_URL`  | None                       | Required by the production override  | Passed to the long-running application as `DATABASE_URL`; use the restricted runtime role and a session-capable endpoint.                                     |
| `DOCKER_APP_ORIGIN`            | `http://localhost:3000`    | Required by the production override  | Passed to the application as `APP_ORIGIN`; use the external HTTPS origin, not the loopback upstream address.                                                  |
| `DOCKER_VISITOR_TOKEN_SECRET`  | Predictable local value    | Required by the production override  | Passed as `VISITOR_TOKEN_SECRET`.                                                                                                                             |
| `DOCKER_BOARD_ACCESS_SECRET`   | Predictable local value    | Required by the production override  | Passed as `BOARD_ACCESS_SECRET`.                                                                                                                              |
| `DOCKER_RATE_LIMIT_KEY_SECRET` | Predictable local value    | Required by the production override  | Passed as `RATE_LIMIT_KEY_SECRET`.                                                                                                                            |
| `DOCKER_RUNNER_IMAGE`          | `badaction-runner:local`   | Optional                             | Selects a prebuilt application image. Pair it with the matching migrator image.                                                                               |
| `DOCKER_MIGRATOR_IMAGE`        | `badaction-migrator:local` | Optional                             | Selects a prebuilt migration image. Pair it with the matching application image.                                                                              |

The runtime variables `TRUSTED_PROXY_HOPS`, `BOARD_RETENTION_DAYS`,
`BOARD_CARD_LIMIT`, `RETENTION_CLEANUP_ENABLED`,
`RETENTION_CLEANUP_INTERVAL_MINUTES`, and `RETENTION_CLEANUP_BATCH_SIZE` are
passed through by Compose under the same names and use the defaults in the
runtime table.

The `POSTGRES_*` settings and `deploy/init-production-db.sh` initialize only an
empty PostgreSQL data directory. Changing them after the named volume exists
does not rename the database, create roles, grant privileges, or update
passwords. Make existing-volume changes with PostgreSQL administration, then
update the corresponding URL and restart the affected service. Never delete a
named volume to apply a configuration change unless every board in it is
disposable or has been restored elsewhere. Changing `COMPOSE_PROJECT_NAME`
selects a different stack and volume; it does not migrate data.

For local development, keep `APP_PORT` and `DOCKER_APP_ORIGIN` aligned. Behind
an HTTPS reverse proxy, `DOCKER_APP_ORIGIN` is the external origin and
`APP_PORT` is only the loopback upstream port.

## Test-only settings

The following variables are guards or controls for repository test wrappers.
They are not production configuration.

| Variable                                   | Accepted values                                                  | Purpose                                                                                                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEST_DATABASE_IS_DISPOSABLE`              | Exactly `1`                                                      | Required by destructive database, cleanup, upgrade, access, browser, and Docker smoke runners. It is a human safety assertion, not automatic URL validation. Never set it for production or shared data. |
| `RUN_DATABASE_TESTS`                       | Exactly `1`                                                      | Enables database integration cases that the Node test runner otherwise skips. `test:database` sets it for its child process; the upgrade runner requires it explicitly.                                  |
| `ACCESS_SMOKE_PORT`                        | Integer `1024`–`65535`; unset chooses a free port                | Overrides the host port reserved by `test:access-smoke`.                                                                                                                                                 |
| `E2E_PORT`                                 | Integer `1024`–`65535`; the wrapper normally chooses a free port | Selects the local Playwright web-server port. Direct Playwright configuration defaults to `3100`.                                                                                                        |
| `PLAYWRIGHT_EXTERNAL_SERVER`               | `0` or `1`; default `0`                                          | Makes the E2E wrapper test an already running loopback server instead of creating a temporary schema and server.                                                                                         |
| `PLAYWRIGHT_EXTERNAL_SERVER_IS_DISPOSABLE` | `0` or `1`                                                       | Must be `1` with external-server mode and must be absent otherwise. It confirms that the external application's data may be mutated.                                                                     |
| `PLAYWRIGHT_BASE_URL`                      | Exact `http://localhost:<port>` origin                           | Required only in external-server mode and must exactly match `APP_ORIGIN`. Production origins are intentionally rejected.                                                                                |
| `SMOKE_BASE_URL`                           | URL; default `http://localhost:3000`                             | Low-level target for `smoke:access`. Repository wrappers normally set it.                                                                                                                                |
| `SMOKE_ORIGIN`                             | Origin; defaults to `SMOKE_BASE_URL`                             | Origin header used by the low-level access smoke. Repository wrappers normally set it.                                                                                                                   |
| `DOCKER_SMOKE_SKIP_BUILD`                  | `0` or `1`                                                       | With `1`, `test:docker` skips builds and requires both `DOCKER_RUNNER_IMAGE` and `DOCKER_MIGRATOR_IMAGE`.                                                                                                |
| `DOCKER_SMOKE_PRODUCTION`                  | `0` or `1`                                                       | With `1`, `test:docker` adds the production override and verifies separate non-superuser migrator and runtime roles.                                                                                     |
| `CI`                                       | Set by the CI provider                                           | Enables stricter Playwright focus/flakiness behavior and CI reporters.                                                                                                                                   |

`UPDATE_PRODUCT_SCREENSHOT` is set internally by the `docs:screenshot` wrapper;
use that npm script instead of setting the variable directly.

Every test runner that creates, drops, expires, or deletes data must point to an
isolated PostgreSQL database. A temporary Prisma schema does not make an
otherwise valuable database safe. See [Development](development.md) for the
supported commands.

## Configuration preflight

For the Compose baseline, validate required interpolation without displaying
the expanded secret-bearing model:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  config --quiet
```

After startup, query `/api/health` and perform the functional checks in
[Deployment](deployment.md). Health validates the runtime setting shapes and a
short database query, but it does not validate migration status, realtime
session behavior, retention execution, backups, or proxy configuration.
