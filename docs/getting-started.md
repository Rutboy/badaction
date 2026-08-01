[English](getting-started.md) | [Русский](ru/getting-started.md) | [Español](es/getting-started.md)

# Getting started

Badaction can run entirely in containers or with Node.js on the host and
PostgreSQL in a container. Both paths use the same forward-only Prisma
migrations.

The application interface is currently in Russian. The English, Russian, and
Spanish documentation describes the same application behavior.

## Requirements

For the container path, install Docker with BuildKit and the Compose v2 command
(`docker compose`). The project does not declare a minimum Docker or Compose
version.

For source development, use:

- Node.js 22.23.2;
- npm 10.9.8;
- PostgreSQL 16;
- Playwright 1.62.1 with its Chromium build for browser tests only.

The exact Node and npm versions are recorded in `.nvmrc` and `package.json`.
Other PostgreSQL major versions are not supported because the migration chain
depends on PostgreSQL 16 behavior.

## Container quick start

Clone the repository and start the application profile:

```bash
git clone https://github.com/Rutboy/badaction.git
cd badaction
docker compose --profile app up --build
```

Compose starts PostgreSQL, runs migrations once, and then starts the non-root
application container. Open <http://localhost:3000>. Check readiness with:

```bash
curl --fail http://localhost:3000/api/health
```

The default credentials are deliberately predictable development values. The
database and application ports bind to loopback, so this Compose configuration
must not be exposed directly to a network.

Stop the foreground stack with `Ctrl+C`, then remove its containers and network:

```bash
docker compose --profile app down
```

The named `postgres-data` volume remains and preserves boards between restarts.
To permanently delete that local database, and only when its data is
disposable, run:

```bash
docker compose --profile app down --volumes
```

If port 3000 is occupied, keep the public port and canonical origin aligned:

```bash
APP_PORT=3100 DOCKER_APP_ORIGIN=http://localhost:3100 \
  docker compose --profile app up --build
```

The production setup is intentionally different. Follow
[Deployment](deployment.md) before exposing an instance.

## Source-development setup

Install the pinned dependencies from `package-lock.json`, create a local
environment file, and start PostgreSQL:

```bash
npm ci
cp .env.example .env
docker compose up -d postgres
npm run prisma:generate
npm run prisma:deploy
npm run dev
```

Open <http://localhost:3000>. The development secrets in `.env.example` are
only for a loopback environment. Do not reuse them for a shared or public
instance, and do not commit `.env`.

Stop Next.js with `Ctrl+C`. Stop the database without deleting its volume:

```bash
npm run db:stop
```

## Browser tests

Install the supported Playwright browser once:

```bash
npx playwright install chromium
```

Browser and database tests deliberately require an explicit disposable-data
guard. See [Development](development.md) before running them; never point those
commands at a database containing data you need.

## Next steps

- Read [Security and privacy](security-and-privacy.md) before sharing boards.
- Use [Configuration](configuration.md) when changing limits or ports.
- See [Troubleshooting](troubleshooting.md) if startup or health checks fail.
