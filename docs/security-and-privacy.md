[English](security-and-privacy.md) | [Русский](ru/security-and-privacy.md) | [Español](es/security-and-privacy.md)

# Security and privacy

Badaction is an accountless collaboration tool, not an anonymity service. It does not ask users to register an account, but it stores board content and browser-scoped access records, and a deployment may process network and operational metadata. Do not use it for information that would be unsafe if the database or host operator could read it.

To report a suspected vulnerability, follow the private reporting instructions in [SECURITY.md](../SECURITY.md). Do not include invitation tokens, owner-claim URLs, visitor cookies, private board content, database dumps, or production secrets in a public issue.

## Security goals

The application is designed to protect:

- private board content from callers who only know or guess a board UUID;
- board integrity from callers without an active membership or the required role;
- vote limits and ordering invariants under concurrent requests;
- raw session and invitation credentials from disclosure through database rows;
- request availability with bounded payloads, pagination, data limits, and rate limiting; and
- browser interactions from common cross-site, framing, content-sniffing, and unsafe-rendering attacks.

The main threats considered are UUID enumeration, stolen or replayed bearer credentials, cross-site mutations, malicious user content, malformed inputs, concurrent mutations, quota races, oversized exports, spreadsheet formula injection, abusive request volume, stale clients, and misconfigured proxies.

## Explicit non-goals

Badaction does not claim to provide:

- absolute anonymity or unlinkability;
- end-to-end or client-side encryption;
- protection from an administrator with host, database, backup, or secret access;
- proof that a display name, author, or assignee represents a particular person;
- account-based recovery after the browser credential is lost;
- protection for a credential copied from a compromised browser or shared by its holder; or
- unlimited denial-of-service resistance.

The host, database, browser, reverse proxy, observability stack, and backup system remain part of the deployment's trusted computing base.

## Data stored by the application

The PostgreSQL schema can contain:

- board titles, settings, revision numbers, creation times, and expiry times;
- column titles, order, and vote limits;
- card text, optional author text, ordering, group membership, and timestamps;
- group titles and primary-card relationships;
- action-item text, optional assignee text, completion state, optional source-card relationships, and timestamps;
- votes linked to cards, columns, quota slots, and a board-scoped derived visitor identity;
- anonymous-session credential hashes, expiry times, and revocation timestamps;
- board memberships, roles, display names, creation times, and revocation timestamps;
- invitation token hashes, use limits, use counts, expiry times, creator references, and revocation timestamps;
- invitation-redemption history; and
- hashed rate-limit bucket keys, counters, and reset times.

User-entered text is stored in plaintext at the application layer. Use encrypted storage and encrypted backups if that is required by your environment. The application does not intentionally store raw invitation tokens or raw anonymous-session credential payloads in PostgreSQL; it stores HMAC-derived hashes. The signed visitor cookie remains in the browser and is presented with requests.

Infrastructure outside the application may additionally observe timestamps, IP addresses, user agents, request paths, response status, and traffic volume. A board path contains its UUID. Invitation tokens are placed after `#` in `/join#token`, so a conforming browser does not send that fragment in the initial HTTP request, but client-side redemption later sends the token in the JSON body.

## Browser credential and session model

The `visitor_token` cookie is a random, signed, browser-scoped credential. It is configured as `HttpOnly`, `SameSite=Lax`, scoped to `/`, and `Secure` in production. Its maximum age is 400 days and a valid credential is periodically re-signed without changing its identity.

The cookie payload is HMAC-derived into a server-side anonymous-session credential hash. Board-specific visitor identities used for votes are derived separately, so the stored vote value is scoped to one board. Rate-limit identities are also derived before bucket keys are hashed.

Possession of a valid cookie is necessary but not sufficient for board access. A protected operation also requires an active anonymous session and an active membership for the requested, unexpired board. Revoked sessions remain as tombstones until their credential lifetime has passed so an old valid cookie cannot recreate an active session by upsert.

There are no accounts, passwords, or email-based recovery. Clearing the cookie, using a different browser profile, rotating credential secrets without a migration plan, or otherwise losing the credential can permanently remove the user's ability to reach existing memberships.

## Board access and roles

A board UUID is a locator, not a credential. Knowledge of the UUID alone does not authorize reads, mutations, exports, or event streams. Requests without an active membership are masked as `404 BOARD_NOT_FOUND` to reduce board enumeration.

Membership roles are limited to:

- `OWNER`: manages settings, columns, groups, action items, invitations, participants, vote resets, and board deletion; and
- `PARTICIPANT`: views the board, votes, creates cards, manages cards created by the current membership, renames the current membership, and may leave the board.

Board creation, session creation, owner membership, and default-column creation occur in one transaction. Access-changing operations lock the relevant active board, membership, or invitation and use serializable transactions with retries where concurrency matters. Database indexes additionally prevent multiple active owners or duplicate active memberships.

Read-only mode blocks content changes and voting but does not prevent an owner from changing board settings or deleting the board. Owners should use it as a collaboration control, not as a legal hold or immutable archive.

## Invitations and owner recovery

Participant invitation and owner-claim tokens are bearer credentials. Anyone who possesses a valid raw token can redeem it, subject to expiry, revocation, use limits, board limits, and existing redemption rules.

Treat every `/join#token` value as sensitive:

- send it only to intended recipients over an appropriate private channel;
- do not paste it into issues, chat rooms, analytics, screenshots, or logs;
- revoke participant invitations that were exposed or are no longer needed; and
- remember that multi-use participant invitations can grant several memberships before reaching their configured maximum.

Only the invitation-creation response contains the raw participant join path. Invitation history responses contain metadata and usage counts but never reconstruct the token.

The operator-only owner-claim command prints a one-time owner URL. It is intended for a verified recovery procedure when a board has no active owner. Its output is a credential: verify the claimant out of band, protect terminal and CI logs, avoid shell-history capture, and deliver the URL privately. It must not be exposed as a public self-service endpoint.

## Request and content protections

State-changing endpoints validate `Sec-Fetch-Site` and, when present, require `Origin` to match the canonical application origin. The signed `SameSite=Lax` cookie provides another cross-site request barrier. Production must set `APP_ORIGIN` to the exact public HTTPS origin and preserve relevant headers through the reverse proxy.

JSON inputs are strictly validated and normally limited to 16 KiB. UUIDs are canonicalized before board-scoped derivation and rate limiting. Bodyless endpoints reject unexpected bodies. Error responses use a safe `{error: {code, message, details?}}` shape and do not expose stack traces or raw Prisma messages.

React renders user content as text; the application does not use user-supplied HTML. Global response headers include a Content Security Policy, frame restrictions, a no-referrer policy, content-type protection, restricted browser permissions, and HSTS in production. Board pages and API responses are marked against indexing, and private state responses use `Cache-Control: no-store`.

JSON and Markdown exports escape data for their formats. CSV output is UTF-8 with a BOM, quotes string cells, escapes quotes and line breaks, and prefixes values that could be interpreted as spreadsheet formulas. Exported files still contain private board data and must be handled accordingly.

## Voting, limits, and abuse controls

Votes use a board-scoped derived visitor identity. PostgreSQL uniqueness constraints allow at most one vote by that identity on one card and reserve per-column quota slots. The database is authoritative; browser state is only a user-interface aid.

Request-rate buckets are shared through PostgreSQL, which makes the main request limits effective across application replicas. The normal key is derived from the visitor credential and operation scope. A second trusted-IP limit is applied only when `TRUSTED_PROXY_HOPS` is configured. Configure the exact proxy topology: trusting the wrong hop count can make forwarded addresses attacker-controlled or collapse unrelated users into one identity.

Rate limits mitigate ordinary abuse but do not replace network-level controls, connection limits, resource monitoring, or upstream denial-of-service protection. The concurrent SSE stream cap is process-local, so a multi-replica deployment should also enforce sensible connection limits at its load balancer.

## Retention and deletion

New boards receive an expiry timestamp based on `BOARD_RETENTION_DAYS`, which defaults to 90 and supports 1–365 days. Changing the setting affects only boards created afterward. Once expiry is reached, normal board reads and access checks reject the board immediately.

Background retention cleanup removes expired boards and their child rows in bounded chunks, then removes unreferenced expired anonymous sessions and expired rate-limit buckets. Cleanup is asynchronous: a row can remain physically present for some time after it becomes inaccessible, especially after downtime or a cleanup failure. Backups, database replicas, snapshots, and external logs can retain data longer than the live database.

Owner-triggered board deletion removes the board and its dependent data immediately within the application transaction, subject to database success. Participant leave and owner revocation preserve historical membership or invitation rows until board retention cleanup; they mark access as revoked rather than erasing all associated history.

Operators should document their actual backup and log retention separately, verify cleanup results, and provide any notices required by their jurisdiction. The application does not provide an automated data-subject identity verification workflow.

## Logging and observability

Retention cleanup emits structured operational counts and deliberately avoids logging board UUIDs when a parent deletion fails. Other platform components may log requests by default.

Configure the application server, reverse proxy, container platform, database, monitoring, and error tracker so they do not record:

- cookies or authorization-like headers;
- JSON request bodies or user-entered board content;
- invitation tokens or owner-claim URLs;
- exported files;
- environment variables, connection strings, or secret-manager payloads; or
- full database errors that may contain connection details.

Restrict access to necessary operational logs, use an explicit retention period, and test redaction. Never enable verbose SQL or request-body logging against a database that contains real board data without a reviewed, temporary incident procedure.

## Operator hardening checklist

- Terminate TLS at a trusted boundary and set the exact HTTPS `APP_ORIGIN`.
- Generate independent, high-entropy values for `VISITOR_TOKEN_SECRET`, `BOARD_ACCESS_SECRET`, and `RATE_LIMIT_KEY_SECRET`; store them in a secret manager, not a repository or image.
- Plan secret rotation. Rotating visitor or board-access secrets without dual-key migration or a recovery procedure invalidates existing credentials or invitations.
- Use a dedicated, least-privilege PostgreSQL role and keep the database on a private network.
- Encrypt database storage and backups, restrict backup access, and regularly test restoration into an isolated environment.
- Apply migrations before routing traffic to a new application version. Do not run incompatible old and new writers together.
- Use a direct or session-mode PostgreSQL connection for `LISTEN` and session advisory locks; transaction-only pooling is incompatible.
- Set `TRUSTED_PROXY_HOPS` only after documenting the real proxy chain.
- Preserve security and no-store headers at the proxy; disable buffering and caching for the SSE route.
- Monitor `503`, `429`, cleanup failure events, database capacity, connection usage, and unusual invitation activity without collecting board content.
- Keep Node.js, Next.js, PostgreSQL, base images, and dependencies on supported security updates.
- Restrict access to the owner-claim command and deliver generated credentials out of band.
- Confirm that source maps, `.env` files, build caches, database dumps, and logs are not included in published images or artifacts.

## Vulnerability reporting

Use the process in [SECURITY.md](../SECURITY.md). Include the affected version or commit, reproducible steps with synthetic data, impact, and any suggested mitigation. Do not test against systems or boards you do not own, degrade a public service, access another user's content, or retain data obtained accidentally.
