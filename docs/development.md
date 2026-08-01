[English](development.md) | [Русский](ru/development.md) | [Español](es/development.md)

# Development

Read [Contributing](../CONTRIBUTING.md) before proposing a change. This page
covers the repository-specific development workflow.

## Repository layout

- `src/app` contains App Router pages and HTTP route handlers.
- `src/components` contains product UI and reusable interface primitives.
- `src/lib/services` owns business operations and database transactions.
- `src/lib/access` owns anonymous sessions, memberships, invitations, and role
  checks.
- `src/lib/realtime` owns PostgreSQL notifications and SSE behavior.
- `src/lib/ratelimit`, `src/lib/validators`, and `src/lib/errors` provide shared
  request protections.
- `prisma/schema.prisma` and `prisma/migrations` define the PostgreSQL schema and
  forward migration history.
- `scripts` contains guarded integration runners, operational commands, and
  repository checks.
- `e2e` contains the Chromium browser suite.

The preferred dependency direction is UI → route handler → service → Prisma →
PostgreSQL. Server Components may call services directly. Keep authorization
and concurrency-sensitive invariants in services or the database rather than
duplicating them in the browser.

## Set up

Follow the source-development path in [Getting started](getting-started.md):

```bash
npm ci
cp .env.example .env
docker compose up -d postgres
npm run prisma:generate
npm run prisma:deploy
npm run dev
```

Use Node.js 22.23.2 and npm 10.9.8. The lockfile and `package.json` must change
together when dependencies intentionally change.

## Fast checks

Run the checks relevant to your change while iterating:

```bash
npm run typecheck
npm test
npm run lint
npm run format:check
```

Before submitting a pull request, run the broader local gates:

```bash
npm run check:docs
npm run check:repo
npm run security:check
npm run check:licenses
npm run build
npm run check:standalone
```

`npm run audit:dependencies` queries the npm advisory service and therefore
requires network access. Review every finding; do not suppress a high-severity
advisory merely to make the command pass.

## Database and browser tests

Database tests can delete or rewrite test data. They are skipped or rejected
unless the runner receives an explicit disposable-data guard. Never use these
commands with production, shared, or otherwise valuable data.

The Docker smoke suite creates an isolated Compose project and temporary volume,
checks migrations, health, access, restart persistence, and graceful shutdown,
then removes that project:

```bash
TEST_DATABASE_IS_DISPOSABLE=1 npm run test:docker
```

For the host-side database suite, first provide a PostgreSQL 16 database that
you created specifically for tests:

```bash
TEST_DATABASE_IS_DISPOSABLE=1 DATABASE_URL='postgresql://...' \
  npm run test:database
```

The Playwright wrapper creates and removes a temporary schema by default:

```bash
TEST_DATABASE_IS_DISPOSABLE=1 DATABASE_URL='postgresql://...' \
  npm run test:e2e
```

Install Chromium with `npx playwright install chromium`. Additional guarded
cleanup, upgrade, and access smoke runners are available in `package.json`.

## Schema changes

Use a local disposable development database when creating a migration:

```bash
npm run prisma:migrate
npm run prisma:generate
```

Commit the new migration directory and generated schema-facing code changes.
Never edit an already applied migration to change a deployed schema. Describe
data conversions, compatibility constraints, backup requirements, and rollback
strategy in the pull request. Production applies existing migrations with
`npm run prisma:deploy`; it never uses `migrate dev` or `migrate reset`.

## Code and interface conventions

- Keep TypeScript strict and narrow unknown input explicitly.
- Use existing validation, error, service, and UI patterns before adding a new
  abstraction or dependency.
- Preserve keyboard navigation, focus visibility, semantic HTML, and mobile
  layout.
- Do not render user-provided HTML.
- Keep user-facing application strings in Russian until the application gains
  an intentional localization system.
- Add tests for success, authorization failures, invalid input, and relevant
  concurrency boundaries.

## Documentation and screenshots

English pages are authoritative. Update the Russian and Spanish translation in
the same change, preserving commands, variable names, and limitations. The
documentation checker validates required pages, switchers, and local links.

Product screenshots live in `docs/assets`. They must use synthetic data and
must not show board URLs, invitation or owner-claim credentials, cookies,
personal information, or operator infrastructure. Screenshot generation uses
the guarded Playwright runner; inspect the image before committing it.

## Dependencies, licenses, and AI assistance

Prefer existing dependencies. If adding one, review its maintenance status,
license, transitive packages, and runtime impact. Update `package-lock.json` and
third-party notices when required, then run the license and security checks.

AI-assisted contributions are welcome, but the contributor remains responsible
for understanding the change, verifying provenance and licensing, removing
sensitive prompt or environment data, and supplying the same tests and review
evidence as hand-written work.
