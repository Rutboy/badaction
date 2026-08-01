[English](troubleshooting.md) | [Русский](ru/troubleshooting.md) | [Español](es/troubleshooting.md)

# Troubleshooting

Start with container status and narrowly scoped logs. Do not paste database
URLs, cookies, invitation fragments, owner-claim URLs, or card content into an
issue.

```bash
docker compose --profile app ps
docker compose --profile app logs migrate app postgres
curl -i http://localhost:3000/api/health
```

## The application port is already in use

Choose another loopback port and make the canonical origin match it:

```bash
APP_PORT=3100 DOCKER_APP_ORIGIN=http://localhost:3100 \
  docker compose --profile app up --build
```

For host development, change `APP_ORIGIN` and the port passed to Next.js
together. Mixing `localhost` and `127.0.0.1` also creates different browser
cookie scopes.

## PostgreSQL does not become healthy

Check `docker compose logs postgres` and verify the host port is available. The
container listens internally on 5432 even when `POSTGRES_PORT` changes the host
mapping. Application containers must use the `postgres` service name, not
`localhost`.

Existing named volumes keep the database and roles created on their first
start. Changing any `POSTGRES_*` value later does not rewrite the cluster or
rerun `deploy/init-production-db.sh`. Apply a reviewed role/password change in
PostgreSQL and update the matching URL, or restore a backup into a newly
configured volume. Do not delete a volume unless its contents are disposable.
Changing `COMPOSE_PROJECT_NAME` silently selects a different named volume.

## Migration container fails

Inspect `docker compose logs migrate`. Typical causes are an invalid
`DOCKER_MIGRATOR_DATABASE_URL` (or local `DOCKER_DATABASE_URL`), insufficient
schema privileges, a non-PostgreSQL-16 server, or an interrupted/manual schema
change. Check the migration state against the intended database:

```bash
DATABASE_URL='postgresql://...' npm run prisma:status
```

Do not edit previously applied migration files or use `prisma migrate reset` on
valuable data. Back up the database before repairing a migration incident.

### Prisma reports an `onDelete: SetNull` warning

`prisma validate` reports a warning for the action-item source relation. The
applied PostgreSQL 16 migration deliberately uses column-list `ON DELETE SET
NULL (source_card_id)` so deletion clears the optional source while preserving
the required `board_id`. Prisma cannot express that column-list form in its
schema. Treat the migration as authoritative and do not replace it with an
ordinary composite `SET NULL` constraint.

## Health returns 503

`GET /api/health` returns 503 while the process is draining, when runtime
configuration is invalid, or when its short database probe fails. The endpoint
does not verify the migration version, the realtime listener, the cleanup
scheduler, backups, or external proxy behavior. Check the application and
database logs before restarting repeatedly.

## Production startup rejects configuration

The production override requires both `DOCKER_MIGRATOR_DATABASE_URL` with the
migrator role and `DOCKER_RUNTIME_DATABASE_URL` with the restricted application
role. The three role names and their passwords must be pairwise distinct, and
every password must contain at least 32 characters. Percent-encode reserved
password characters in the URLs. The application also requires an exact HTTPS
`APP_ORIGIN` and three different secrets of at least 32 characters.
`APP_ORIGIN` must not contain a path, query, fragment, credentials, or trailing
slash. Known development placeholders are rejected. See
[Configuration](configuration.md) for accepted ranges.

## Mutations return an origin error

The browser origin must exactly match `APP_ORIGIN`, including scheme, hostname,
and port. Set forwarded headers at the HTTPS proxy, but do not set
`TRUSTED_PROXY_HOPS` above zero unless the proxy chain is controlled and its
`X-Forwarded-For` value is trustworthy.

## A board URL returns “not found”

A board UUID is a locator, not an access credential. The same browser must also
hold an active visitor session and board membership. Clearing cookies, changing
browser profiles or hostnames, leaving a board, or being removed invalidates
that access. Participants need a new invitation. Owner access cannot be
recovered from the UUID alone; use the operator procedure in
[Operations](operations.md) only after verifying the requester.

## An invitation link does not work

Invitation tokens appear after `#` and are processed by the browser; fragments
are not sent in HTTP requests. Use the complete `/join#token` URL in the same
browser that should receive membership. A link can also be expired, revoked, or
out of uses. Never publish the URL while asking for help.

## Realtime updates lag or reconnect

The client falls back to periodic reconciliation, so the board can continue to
work with slower updates. For normal SSE behavior, verify that the proxy:

- disables response buffering, caching, and compression for the event route;
- uses an upstream read timeout longer than the 12-second heartbeat;
- does not transform `text/event-stream` responses.

The database URL used by the application must allow a persistent PostgreSQL
session for `LISTEN`. Transaction-only pooling is incompatible. Health may
remain green while this path is broken, so inspect browser network activity and
application logs. See [Deployment](deployment.md).

## Browser tests cannot launch Chromium

Install only the supported Playwright browser for this project:

```bash
npx playwright install chromium
```

On Linux CI hosts, Playwright may require its documented system dependencies.
The project does not claim support for Firefox or WebKit.

## A standalone image fails its license check

Build through the repository script so the standalone output is sanitized and
its dependency notices are generated:

```bash
npm run build
npm run check:standalone
```

The preparation step also rejects environment files in `.next/standalone`.

## Asking for help

Use the process in [Support](../SUPPORT.md). For a suspected vulnerability, use
the private channel in [Security](../SECURITY.md) instead of a public issue.
