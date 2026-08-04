[English](operations.md) | [Русский](ru/operations.md) | [Español](es/operations.md)

# Operations

Operators are responsible for the database, secrets, HTTPS proxy, backups,
monitoring, update sequencing, and infrastructure logs. The Compose files offer
a single-host baseline; they do not supply managed PostgreSQL, high
availability, remote backup storage, certificates, or alerting.

An installation created by the guided [Quick Start](quick-start.md) can use
`sudo badaction doctor`, `status`, `logs`, `backup`, `start`, `stop`, and
`restart`. That helper includes the optional Caddy Compose layer. The explicit
commands below remain useful for understanding and customizing each operation.

Commands below use `.env.production` and both Compose files. Run them from the
reviewed repository checkout. Never paste expanded environment values, visitor
cookies, invitation fragments, owner-claim URLs, or user content into an issue
or public log.

## Health and monitoring

The unauthenticated `GET /api/health` endpoint returns `Cache-Control: no-store`
and one of:

```json
{ "status": "ok" }
```

with HTTP 200, or:

```json
{ "status": "unavailable" }
```

with HTTP 503. A 200 response means:

- required runtime configuration parsed successfully;
- the application is not in its draining state;
- PostgreSQL answered `SELECT 1` within the 1.5-second application deadline.

It does not check the applied migration set, realtime `LISTEN` session,
retention-cleanup progress, proxy streaming, backup freshness, disk space, or a
complete board operation. Health can therefore remain green while realtime or
cleanup is misconfigured.

Use the endpoint for readiness and supplement it with:

- container restart, CPU, memory, filesystem, and PostgreSQL capacity alerts;
- `prisma migrate status` against the intended database during updates;
- cleanup-event monitoring and alerting on partial or failed results;
- a synthetic board flow that verifies HTTPS, cookie persistence, membership,
  a mutation, SSE invalidation, and export without retaining real credentials;
- backup age checks and scheduled restore drills.

Start diagnosis with narrowly scoped status and logs:

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

curl --fail --show-error --silent https://retro.example.com/api/health
```

Sanitize logs before sharing them. See [Troubleshooting](troubleshooting.md)
for common failure modes.

## Backups

Back up PostgreSQL independently of the named Docker volume. A volume preserves
data across container replacement but does not protect against host loss,
operator error, corruption, or a destructive schema change.

The following command creates a PostgreSQL custom-format logical backup on the
host. Replace the output filename according to your retention policy:

```bash
install -d -m 700 backups
umask 077
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  exec -T postgres \
  sh -c 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  > backups/badaction.dump
```

An online `pg_dump` is transactionally consistent, but writes accepted after
its snapshot are not in that file. Define a maintenance or continuous recovery
strategy when that loss window is unacceptable. For larger installations,
consider provider-native physical backups and point-in-time recovery in
addition to logical dumps.

For every backup:

1. Record the application source revision, PostgreSQL major version, and UTC
   timestamp separately from the dump.
2. Encrypt it, restrict access, and copy it off the application host.
3. Verify that `pg_restore --list` can read it.
4. Restore it regularly into an isolated PostgreSQL 16 environment and run
   application-level checks.
5. Apply a backup retention policy consistent with your privacy commitments.

Backups contain board titles and content, display names, votes, action items,
membership history, and credential hashes. They may preserve data after the
live retention cleanup deletes it. Protect and expire them as sensitive data;
application retention does not erase independent backups or proxy logs.

Do not use a filesystem copy of a live PostgreSQL data directory as a backup
unless the PostgreSQL platform provides a documented, consistent snapshot
procedure.

## Restore drill

Test restores away from the live database. Use PostgreSQL 16 and an empty
database; never restore over the only current copy.

For a local drill, copy the production template to a separate ignored
`.env.restore`. Fill every blank with fresh test-only values, keep all three
database roles and passwords distinct, select unused `POSTGRES_PORT` and
`APP_PORT` values, and use a matching local `DOCKER_APP_ORIGIN`. The explicit
project name gives the drill a separate named volume. Start the production
PostgreSQL service so the restricted migrator and runtime roles are initialized:

```bash
cp deploy/production.env.example .env.restore
# Fill every blank with isolated test values before continuing.
docker compose \
  --env-file .env.restore \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --project-name badaction-restore \
  up --detach --wait postgres
```

Restore directly into the empty `POSTGRES_DB`. Connect as the administrative
role but use `--role` so restored objects are owned by the migrator and its
default privileges grant the runtime role data access:

```bash
docker compose \
  --env-file .env.restore \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --project-name badaction-restore \
  exec -T postgres \
  sh -c 'pg_restore --username "$POSTGRES_USER" --role "$POSTGRES_MIGRATOR_USER" --dbname "$POSTGRES_DB" --exit-on-error --no-owner --no-privileges' \
  < backups/badaction.dump
```

Start the production profile against the restored database:

```bash
docker compose \
  --env-file .env.restore \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --project-name badaction-restore \
  --profile app \
  up --detach --wait --wait-timeout 240
```

An entirely separate host is safer still. After restoring:

1. Confirm that the one-shot migration container completed successfully. Its
   wrapper applies forward migrations and removes runtime access to
   `_prisma_migrations`.
2. Check health and row counts, then create a new synthetic board to verify
   membership, realtime updates, and exports.

Fresh HMAC secrets intentionally cannot validate restored, pre-existing session
or invitation credentials. A credential-continuity drill requires a separately
controlled copy of the original HMAC secrets and a dedicated test credential;
treat that drill as production-sensitive.

Do not publish restored user data or use an ordinary user's production cookie
against the test instance. Remove the drill environment according to its
approved data-destruction procedure after recording the result.

When its restored data is confirmed disposable, remove the isolated stack and
volume:

```bash
docker compose \
  --env-file .env.restore \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --project-name badaction-restore \
  --profile app \
  down --volumes --remove-orphans
```

For an actual recovery, stop all application writers, provision a clean
PostgreSQL 16 target with distinct administrative, migrator, and runtime roles,
restore the selected backup as the migrator role, apply only the forward
migrations required by the chosen application version, and verify it in
isolation before changing the application connection. Keep the previous
database intact and access-restricted until recovery is accepted.

## Updates and forward migrations

Prisma migrations are forward-only. The project does not promise that an old
application can run against a newly migrated schema or that old and new writers
can run concurrently. Use a coordinated maintenance window unless the specific
migrations have been reviewed as mixed-version safe.

For the Compose baseline:

1. Review the source diff and every new SQL migration. Check PostgreSQL 16
   compatibility, locks, data conversions, required free space, and expected
   duration on a restored production-sized copy.
2. Build or obtain a matching `migrate` and `app` image pair before downtime.
3. Create and verify a backup.
4. Stop every application writer.
5. Run `prisma migrate deploy` through the new migrator image.
6. Start the new application and verify migration status, health, and a
   disposable end-to-end flow.

The core Compose commands are:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  build migrate app

docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  stop app

docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  run --rm migrate

docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  up --detach --wait --wait-timeout 240
```

With prebuilt images, pull the verified image pair and omit the build step. The
normal `migrate` service may check migrations again during `up`; `migrate
deploy` is designed to apply only pending migrations.

The health endpoint does not confirm migration status. Check the migrator exit
and logs, and run `npm run prisma:status` from a trusted source environment
using the exact target `DATABASE_URL`.

There are no automated down migrations. If an application rollback is not
compatible with the migrated schema, restore the pre-update backup into a new
database and deploy the matching older application against it. Do not edit an
applied migration, run `prisma migrate reset`, drop schemas, or truncate tables
to improvise a rollback on valuable data.

## Retention cleanup

Each board receives an immutable expiry timestamp when it is created. The
board becomes inaccessible when it expires; physical deletion follows on a
cleanup pass and is not guaranteed at the exact expiry second.

Embedded cleanup is enabled by default. Each application process attempts a
pass at startup, then after `RETENTION_CLEANUP_INTERVAL_MINUTES`. Multiple
replicas coordinate through a PostgreSQL advisory lock and a database-stored
minimum-interval marker, so only one embedded attempt performs work for a due
interval. Each attempt uses bounded batches, and large board child sets are
deleted in chunks. A failing board or cleanup class is reported without
rolling back all other independent work.

Monitor the structured application events:

- `retention_cleanup_completed`;
- `retention_cleanup_aborted`;
- `retention_cleanup_skipped_advisory_lock`;
- `retention_cleanup_skipped_minimum_interval`.

Treat a non-empty `failedSteps`, a positive `boardDeleteFailures`, repeated
aborts, or an absence of successful runs as an alert. Cleanup activity adds a
temporary PostgreSQL session per attempting replica and can create database
load; tune interval and batch size against observed capacity.

If `RETENTION_CLEANUP_ENABLED=false`, arrange an external trusted scheduler.
From a full source checkout with dependencies and the target `DATABASE_URL`, a
manual pass is:

```bash
DATABASE_URL='postgresql://...' npm run cleanup:expired -- 1000
```

The optional batch argument must be an integer from `1` to `10000`. The command
prints a JSON result and exits non-zero for an incomplete or failed pass. It
uses the same advisory lock but does not apply the embedded scheduler's minimum
interval, so choose the external cadence deliberately.

The included GitHub Actions workflow is a manual external-cleanup template; it
has no schedule by default. Add a schedule only after creating a protected
`production` environment with the `DATABASE_URL` secret and monitoring failed
or missing runs. Granting a hosted CI runner direct database access is a
deployment decision, not a requirement. Embedded and external runs are
concurrency-safe through the advisory lock, but redundant runs still consume
resources.

Never disable cleanup without a replacement schedule. Verify that backups and
infrastructure logs have separate deletion policies; live cleanup cannot erase
their copies.

## Graceful shutdown

The runner supervises Next.js. On the first `SIGTERM` or `SIGINT`, it begins
draining, causing `/api/health` to return 503, asks the application lifecycle to
stop cleanup, closes the shared PostgreSQL listener, and then forwards the
signal to the server process.

The application lifecycle waits up to 25 seconds. The supervisor waits up to
30 seconds for shutdown preparation, and the Compose service has a 60-second
grace period. Configure any external orchestrator or service manager with at
least 60 seconds and remove a draining instance from traffic promptly. A second
signal can force termination; use it only when accepting interrupted work.

Stop the application without removing PostgreSQL data:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  stop app
```

Observe the 503 draining state and a clean container exit in deployment
automation. Do not treat a forced stop as a successful graceful shutdown.

## Multiple replicas

All replicas must use the same database, public origin, and current application
secrets. PostgreSQL notifications reach each replica's persistent listener, so
sticky sessions are not required for event delivery. Embedded cleanup is
coordinated by the advisory lock and database interval marker.

Scaling still requires explicit design work:

- every replica adds a Prisma pool, a persistent listener after realtime use,
  and temporary cleanup connections;
- the in-process SSE stream limit is local to a replica, so ingress should also
  enforce a global connection and request policy;
- all replicas must be stopped for a migration that is not mixed-version safe;
- the included Compose files do not deploy or balance multiple replicas;
- health can pass on one replica while its listener or proxy path is broken.

Load-test request, stream, reconnect, and cleanup behavior with the actual
proxy and database pooler before increasing replica count.

## Operator-assisted owner claim

Badaction has no account recovery. Clearing the owner browser's visitor cookie
loses the credential that resolves its membership. A board UUID alone cannot
prove ownership.

The repository includes a narrow operator command for a board that has no
active owner. Use it only after an independent process verifies the claimant
and authorizes recovery. The service refuses to issue a claim while an active
owner membership exists; an owner row tied to an expired or revoked anonymous
session is revoked during the attempt. Losing a cookie while its session and
owner row remain active is not recoverable with this command and requires a
separate, reviewed incident decision.

Run the command from a protected full source checkout with the exact production
`DATABASE_URL`, `APP_ORIGIN`, `VISITOR_TOKEN_SECRET`, `BOARD_ACCESS_SECRET`, and
`RATE_LIMIT_KEY_SECRET` injected under their runtime names:

```bash
npm ci
npm run prisma:generate
npm run access:claim-owner -- <board-uuid>
```

The command validates production configuration before mutating state. It
revokes an older outstanding owner claim, creates a single-use claim that
expires after at most 24 hours or at board expiry, and prints the resulting
`/join#token` URL. That URL is a bearer credential.

Do not redirect the URL to shared logs, command transcripts, tickets,
analytics, screenshots, or chat. Deliver it out of band to the verified owner,
record only non-secret audit metadata, and confirm redemption. Running the
command again invalidates the previous unredeemed owner claim.

Read [Security and privacy](security-and-privacy.md) for the access and data
model, and [Configuration](configuration.md) before changing credentials,
retention, proxy trust, or database settings.
