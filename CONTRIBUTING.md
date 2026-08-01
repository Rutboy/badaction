# Contributing to Badaction

Thank you for helping improve Badaction. Focused changes are easier to review and
safer to release, particularly when anonymous access, database migrations, or
data retention are involved.

By participating in this project, you agree to follow the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Before you start

- Search existing issues before opening a new one.
- A bug fix or small, backward-compatible improvement can usually go directly to
  a pull request.
- Discuss substantial product, public API, access-control, or schema changes in
  an issue before investing in an implementation.
- Report vulnerabilities privately as described in
  [SECURITY.md](./SECURITY.md). Do not include vulnerability details in an issue.
- Never commit real credentials, database dumps, visitor cookies, user content,
  or raw invitation and owner-claim URLs.

## Development environment

Use the Node.js and npm versions declared in `.nvmrc` and `package.json`. Local
development also requires Docker with Compose for PostgreSQL 16, or an
equivalent disposable PostgreSQL instance.

```bash
nvm use
npm ci
cp .env.example .env
npm run db:start
npm run prisma:deploy
npm run prisma:generate
npm run dev
```

The values in `.env.example` are for local development only. Keep the three
application secrets independent, and do not reuse development values in an
externally accessible deployment. See the project documentation for the full
[configuration and deployment guidance](./docs/README.md).

## Architecture boundaries

Keep dependencies moving in this direction:

```text
React/UI -> Route Handler -> service -> Prisma -> PostgreSQL
```

Server Components may call services directly for server-side loading. Business
rules, authorization, and multi-record transactions belong in services, not in
UI components or Route Handlers. Use the shared Prisma client and existing
validators, error handling, constants, and UI primitives instead of duplicating
them.

A board UUID is only a locator. Board-scoped access also requires an active
anonymous session and membership. Preserve the `OWNER` and `PARTICIPANT` role
model, mask inaccessible boards as not found, and treat invitation, owner-claim,
and visitor tokens as credentials. Do not move security-sensitive enforcement
to the client.

## Code style

- Keep TypeScript strict and prefer precise types. Narrow `unknown` explicitly;
  avoid `any` unless its use is justified.
- Follow the existing format: two-space indentation, double quotes, semicolons,
  and trailing commas.
- Use `@/` imports for modules under `src`.
- Use English identifiers and comments. User-facing interface messages are in
  Russian unless a product change explicitly introduces localization.
- Use existing shadcn-style components and design tokens before adding another
  component or UI dependency.
- Comments should explain constraints or intent, not restate the code.
- Do not combine unrelated formatting, refactoring, or technical-debt cleanup
  with the requested change.

## Database and migrations

Every Prisma schema change requires a new forward migration. Create and inspect
it locally with:

```bash
npm run prisma:migrate
npm run prisma:generate
npm run prisma:validate
```

Never edit an already published migration, run `prisma migrate reset` against a
database containing user data, or test destructive cleanup against production.
Use a disposable database for migration and concurrency tests. Pull requests
must describe compatibility, rollout, backup, and rollback considerations for
schema changes. If old and new application versions cannot safely share the
schema, state that a coordinated deployment is required.

## Tests and checks

Add or update tests for both successful behavior and relevant failures or edge
cases. Before opening a pull request, run the checks that apply to your change;
the expected baseline is:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Repository, dependency, license, and security checks should also pass:

```bash
npm run check:repo
npm run check:licenses
npm run audit:dependencies
npm run security:check
```

Database and concurrency tests must target an explicitly disposable PostgreSQL
database:

```bash
TEST_DATABASE_IS_DISPOSABLE=1 npm run test:database
```

Never set that guard for production or a database containing user data. Run the
relevant integration, browser, and Docker suites for changes in those areas. If
a check cannot be run, list it and explain why in the pull request; do not
disable a check merely to obtain a passing result.

## Security and privacy

- Validate all untrusted input on the server and return the established safe
  error shape without internal exception details.
- Preserve origin checks, rate limits, membership checks, single-use credential
  behavior, vote constraints, and CSV formula-injection protection.
- Do not log secrets, raw bearer URLs, visitor cookies, full user content, or
  database connection strings.
- Use synthetic data in tests, screenshots, issue reports, and pull requests.
- Keep authentication, authorization, and concurrency-sensitive invariants in
  services and database constraints or transactions, not only in the UI.

## Dependencies and third-party material

Prefer the existing stack and add a dependency only when a small, maintainable
implementation is not sufficient. Explain the need in the pull request and:

- update `package.json` and `package-lock.json` together;
- review runtime and transitive impact;
- run the dependency audit and license checks;
- confirm that the license is compatible with this project;
- update `THIRD_PARTY_NOTICES.md` when copied or bundled material requires
  attribution.

Do not vendor generated bundles or copied assets without documenting their
source, version, license, and required notices.

## Pull requests

Keep each pull request reviewable and scoped to one coherent change. Its
description should include:

- the problem and user-visible behavior;
- the approach and important trade-offs;
- linked issues, when applicable;
- tests and commands actually run, with their results;
- migrations, deployment, compatibility, security, and privacy impact;
- sanitized screenshots for visible UI changes.

Update public documentation when commands, configuration, behavior, APIs, or
operational requirements change. Address review feedback with additional commits
unless a maintainer requests another workflow.

## AI-assisted contributions

AI-assisted contributions are welcome, but the contributor remains fully
responsible for the submission. You must understand and review the proposed
code, verify its correctness and security, run appropriate tests, and ensure
that its provenance and license are acceptable. Do not send repository secrets,
private vulnerability details, user data, or bearer credentials to AI tools.
Generated output that you cannot explain or maintain is not ready to submit.

## Contribution license

Unless explicitly stated otherwise, by submitting a contribution you represent
that you have the right to do so and agree that it is licensed under the
project's [MIT License](./LICENSE). Third-party material remains subject to its
own license and attribution requirements.
