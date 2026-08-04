[English](README.md) | [Русский](README.ru.md) | [Español](README.es.md)

# Badaction

Badaction is a lightweight, self-hosted, open-source retrospective board for
teams. It does not require user accounts: access is tied to an anonymous browser
session and a board membership instead.

The application interface is currently in Russian; the project documentation is
available in English, Russian, and Spanish.

![A Badaction retrospective board with columns, grouped cards, votes, and an action item](docs/assets/product-board.png)

## Features

- Create a board without registering an account.
- Return to active owned and joined boards from the home page in the same
  browser.
- Invite participants with expiring links and a bounded number of uses.
- Separate owner and participant permissions.
- Create, rename, reorder, and remove up to ten columns with per-column vote
  limits.
- Add cards with an optional author, edit owned cards, and move cards using
  pointer, touch, or keyboard controls.
- Vote, sort each column independently by vote count without changing its saved
  card order, group related cards, and turn outcomes into assignable action
  items. Dragging a card from the vote-count view makes the displayed order the
  saved order for the affected columns.
- Pause cards or voting, make a board read-only, and reset votes as the owner.
- Receive near-real-time updates through PostgreSQL `LISTEN/NOTIFY` and
  Server-Sent Events, with periodic state reconciliation as a fallback.
- Export a board as JSON, CSV, or Markdown.
- Expire boards automatically after a configurable retention period.

## Quick start

You need Docker with BuildKit and the Compose v2 command (`docker compose`).

```bash
git clone https://github.com/Rutboy/badaction.git
cd badaction
docker compose --profile app up --build
```

Open <http://localhost:3000>. The one-shot migration container applies the
database migrations before the application starts.

The default Compose credentials are deterministic development values and both
published ports are bound to loopback. Do not expose this configuration to a
network. Stop the stack with `Ctrl+C`, then run:

```bash
docker compose --profile app down
```

The `postgres-data` volume persists. To permanently delete local boards and the
database, run `docker compose --profile app down --volumes` only when that data
is disposable.

For local development outside containers, see
[Getting started](docs/getting-started.md).

## Requirements

- Docker with BuildKit and Compose v2 for the container quick start. The project
  does not declare a minimum Docker or Compose release.
- Node.js 22.23.2 and npm 10.9.8 for source development; both are pinned in
  `.nvmrc` and `package.json`.
- PostgreSQL 16. The migrations use PostgreSQL 16 behavior and other major
  versions are not supported.
- Playwright 1.62.1 and its Chromium build only for browser tests and screenshot
  generation. There is no formal cross-browser support matrix.

## Self-hosting

The repository includes non-root migrator and application images plus a
production Compose override that requires operator-supplied credentials. It is
a single-host deployment baseline: you must still provide HTTPS, a reverse
proxy, backups, monitoring, and enough PostgreSQL connections.

Read [Deployment](docs/deployment.md) before exposing an instance. In
particular, SSE proxy buffering must be disabled, and the database connection
must support session semantics; transaction-only pooling is incompatible with
the PostgreSQL listener and cleanup lock.

## Configuration

Production requires:

- separate PostgreSQL administrative, migrator, and restricted application
  roles with different passwords of at least 32 characters;
- `DOCKER_MIGRATOR_DATABASE_URL` and `DOCKER_RUNTIME_DATABASE_URL` for
  PostgreSQL 16 in the `public` schema;
- an exact HTTPS origin in `DOCKER_APP_ORIGIN` without a trailing slash;
- pairwise distinct `DOCKER_VISITOR_TOKEN_SECRET`,
  `DOCKER_BOARD_ACCESS_SECRET`, and `DOCKER_RATE_LIMIT_KEY_SECRET` values of at
  least 32 characters.

Retention defaults to 90 days for new boards, and the default total card limit
is 500 per board. Proxy trust, cleanup scheduling, ports, Docker overrides, and
test-only settings are documented in [Configuration](docs/configuration.md).

## Technology

- Next.js App Router and React render the server-loaded board and interactive UI.
- TypeScript and Zod define application types and validate request input.
- Prisma provides the service-layer database client and forward migrations.
- PostgreSQL stores all product state, rate-limit buckets, realtime
  notifications, and cleanup coordination.
- dnd-kit provides pointer, touch, and keyboard drag-and-drop behavior.
- Tailwind CSS, Radix primitives, shadcn/ui-derived components, Lucide, and
  Sonner provide the interface layer.
- Node's test runner and Playwright cover unit, integration, and browser flows.
- Docker builds separate migration and standalone runtime images.

See [Third-party notices](THIRD_PARTY_NOTICES.md) for attribution and the
generated standalone license manifest for runtime package notices.

## Security, privacy, and retention

Badaction is accountless, not absolutely anonymous. The application stores a
signed `HttpOnly` visitor cookie and derives board-scoped identifiers from it;
the server operator, hosting provider, or reverse proxy may still keep network
logs.

A board UUID is only a locator. Reading or changing a board also requires an
active anonymous session and membership. Invitation URLs are bearer
credentials: share them privately and do not place them in logs, screenshots,
analytics, or public chat. Losing or clearing the visitor cookie loses the
associated memberships and vote identity; participants need another invitation,
while owner recovery requires an operator-assisted procedure.

Boards and their child data expire after `BOARD_RETENTION_DAYS` (90 by default).
Cleanup is automatic but operators remain responsible for verifying it and for
their own database backups and infrastructure logs. See
[Security and privacy](docs/security-and-privacy.md) and report vulnerabilities
through [SECURITY.md](SECURITY.md), never through a public issue.

## Documentation

The English documentation is the source of truth:
[Documentation index](docs/README.md).

Russian and Spanish translations are available from the language switcher at
the top of this page.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), the
[Code of Conduct](CODE_OF_CONDUCT.md), and [Support](SUPPORT.md) before opening
an issue or pull request.

## AI transparency

Badaction was created with substantial assistance from AI coding tools. AI
assistance does not change the project's licensing, security, testing, review,
or maintenance requirements.

## License

Badaction is distributed under the [MIT License](LICENSE).
