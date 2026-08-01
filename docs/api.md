[English](api.md) | [Русский](ru/api.md) | [Español](es/api.md)

# Browser-facing API

Badaction exposes HTTP endpoints used by its own web interface. This is an internal application API, documented to help contributors and self-hosting operators understand the running system. It is **not a stable public integration contract**: endpoint paths, request fields, response fields, error codes, and limits may change together with the UI without semantic-versioning guarantees or a compatibility window.

Use exports for moving board data out of the application. If you build an external client, pin it to a specific Badaction commit and test it during every upgrade.

The implementation in `src/app/api/`, its validators, and its services is authoritative. This page intentionally summarizes the interface rather than defining a separate schema.

## Conventions

- The base path is `/api` on the same origin as the web application.
- JSON endpoints use UTF-8 JSON. JSON mutations require `Content-Type: application/json` and normally accept at most 16 KiB.
- The application sets and reads the signed `visitor_token` cookie. Browser requests use same-origin credentials; there is no bearer-token or API-key authentication mode.
- Protected board operations require an active anonymous session and active membership for that board. A board UUID is only a locator.
- State-changing requests are checked for same-origin browser metadata. When an `Origin` header is present it must exactly match the canonical application origin.
- Board, mutation, access, export, and error responses use `Cache-Control: no-store`.
- IDs created by the application are UUID v4 values. Content routes require UUID v4 syntax; access-management routes accept UUID syntax more generally. All accepted UUIDs are canonicalized to lowercase.
- Timestamps are ISO 8601 strings. Board revisions are canonical non-negative decimal strings because they originate from PostgreSQL `bigint`.
- Unless listed otherwise, successful JSON mutations return `200`. Creation endpoints return `201`; selected access and board deletions return `204` with no body.

## Access model

The cookie is necessary but does not itself grant access to every board. The server resolves it to an anonymous session and then looks up a board membership:

- `OWNER` can manage settings, access, columns, groups, action items, vote resets, and board deletion.
- `PARTICIPANT` can read and export the board, vote, create cards, manage cards created by the current membership, rename that membership, and leave.

When the session has no active membership, board-scoped access is normally masked as `404 BOARD_NOT_FOUND`. Clients must not treat knowledge of a UUID as authorization. See [Architecture](architecture.md) and [Security and privacy](security-and-privacy.md) for the complete model.

## Board snapshot

`GET /api/boards/{boardId}?limit=50` returns the authoritative snapshot used by the UI. `limit` applies to the first top-level item page in each column; it defaults to 50 and must be between 1 and 100.

The response has this high-level shape:

```json
{
  "id": "board UUID",
  "title": "Retrospective title",
  "revision": "12",
  "createdAt": "ISO timestamp",
  "expiresAt": "ISO timestamp",
  "settings": {
    "cardsEnabled": true,
    "votingEnabled": true,
    "readOnly": false
  },
  "viewer": {
    "role": "OWNER",
    "displayName": "Владелец"
  },
  "capabilities": {
    "canManageSettings": true,
    "canManageAccess": true,
    "canManageColumns": true,
    "canManageGroups": true,
    "canManageActionItems": true,
    "canResetVotes": true,
    "canDeleteBoard": true,
    "canLeaveBoard": false,
    "canCreateCards": true,
    "canVote": true
  },
  "columns": [],
  "remainingVotesByColumn": {},
  "actionItems": []
}
```

Each column contains `id`, `title`, `position`, `voteLimit`, an `items` page, `totalCount`, and `nextCursor`. An item is either a card or a group. Cards include text, optional author, order, vote state, viewer capabilities, and timestamps. Groups include their cards, primary-card ID, optional title, aggregate vote state, capabilities, and timestamps. Action items include text, optional assignee, completion state, order, optional source-card ID, and timestamps.

## Endpoint families

### Boards

| Method and path                | Access                                          | Request                                                             | Result                                                                                                                            |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/boards`             | Visitor cookie; no existing membership required | `{title}`                                                           | `201` with board ID, board URL, title, revision, and timestamps. Also creates the session, owner membership, and default columns. |
| `GET /api/boards/{boardId}`    | Member                                          | Query `{limit?}`                                                    | Board snapshot described above.                                                                                                   |
| `PATCH /api/boards/{boardId}`  | Owner                                           | One or more of `{title?, cardsEnabled?, votingEnabled?, readOnly?}` | Current revision, title, and settings.                                                                                            |
| `DELETE /api/boards/{boardId}` | Owner                                           | No body                                                             | `204`; deletes the board and dependent data.                                                                                      |

There is no endpoint that lists every board owned by the current browser.

### Columns

| Method and path                                      | Access | Request                                           | Result                                                                         |
| ---------------------------------------------------- | ------ | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `POST /api/boards/{boardId}/columns`                 | Owner  | `{title, voteLimit, placement, expectedRevision}` | `201` with revision and column.                                                |
| `PATCH /api/boards/{boardId}/columns/{columnId}`     | Owner  | `{title?, voteLimit?, expectedRevision?}`         | Revision and column. `expectedRevision` is required when changing `voteLimit`. |
| `POST /api/boards/{boardId}/columns/{columnId}/move` | Owner  | `{placement, expectedRevision}`                   | Revision and column.                                                           |
| `DELETE /api/boards/{boardId}/columns/{columnId}`    | Owner  | An explicit deletion form with `expectedRevision` | Revision. The last column cannot be deleted.                                   |

`placement` identifies the neighboring column IDs with `{beforeColumnId, afterColumnId}`; either neighbor can be `null` at an edge. Deleting a non-empty column requires either `{strategy: "moveCards", targetColumnId, expectedRevision}` or `{strategy: "deleteCards", confirmDeleteCards: true, expectedRevision}`. An empty column needs only `{expectedRevision}`.

Boards support at most 10 columns. Column titles contain 1–80 trimmed characters and `voteLimit` is an integer from 0 to 20.

### Cards and pagination

| Method and path                                  | Access                        | Request                                         | Result                                                    |
| ------------------------------------------------ | ----------------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| `GET /api/boards/{boardId}/cards`                | Member                        | Query `{columnId, cursor?, limit?}`             | One column's item page.                                   |
| `POST /api/boards/{boardId}/cards`               | Member                        | `{columnId, text, author?}`                     | `201` with revision and card.                             |
| `PATCH /api/boards/{boardId}/cards/{cardId}`     | Owner or current card creator | `{text?, author?}`                              | Revision and card.                                        |
| `POST /api/boards/{boardId}/cards/{cardId}/move` | Owner or current card creator | `{targetColumnId, placement, expectedRevision}` | Revision and card. Grouped cards must be ungrouped first. |
| `DELETE /api/boards/{boardId}/cards/{cardId}`    | Owner or current card creator | `{expectedRevision}`                            | Revision.                                                 |

The page query requires `columnId`. `limit` defaults to 50 and supports 1–100. The response contains `{columnId, revision, items, totalCount, nextCursor}`. Pass the opaque `nextCursor` unchanged to retrieve another page for the same board and column. A malformed, stale, or mismatched cursor returns `400 INVALID_CURSOR`.

Card text contains 1–1000 trimmed characters. `author` is `null` or 1–120 trimmed characters. The total card limit is controlled by `BOARD_CARD_LIMIT` and is enforced transactionally.

Item placement uses `{before, after}`, where each non-null reference is `{kind: "CARD" | "GROUP", id}`. References describe adjacent top-level items in the target column. If concurrent work makes the placement stale, the server returns a revision conflict.

### Votes

| Method and path                                    | Access | Request                                           | Result                                                                                                        |
| -------------------------------------------------- | ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `PUT /api/boards/{boardId}/cards/{cardId}/vote`    | Member | No body                                           | `{revision, cardId, voteCount, viewerHasVoted, remainingVotesInColumn}`. Repeating the request is idempotent. |
| `DELETE /api/boards/{boardId}/cards/{cardId}/vote` | Member | No body                                           | The same vote-state shape. Repeating the request is idempotent.                                               |
| `POST /api/boards/{boardId}/votes/reset`           | Owner  | `{confirmation: "RESET_VOTES", expectedRevision}` | Revision and number of deleted votes.                                                                         |
| `POST /api/boards/{boardId}/cards/{cardId}/like`   | Member | No body                                           | Deprecated compatibility adapter. Returns `Deprecation: true`; new clients should use `PUT .../vote`.         |

One board-scoped visitor identity can vote once per card and no more than the target column's `voteLimit`. A zero limit disables voting in that column. PostgreSQL votes and quota slots are authoritative.

### Groups

| Method and path                                       | Access | Request                                                        | Result                                                                             |
| ----------------------------------------------------- | ------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `POST /api/boards/{boardId}/groups`                   | Owner  | `{columnId, cardIds, primaryCardId, title?, expectedRevision}` | `201` with revision and group.                                                     |
| `PATCH /api/boards/{boardId}/groups/{groupId}`        | Owner  | `{title?, primaryCardId?, expectedRevision?}`                  | Revision and group. `expectedRevision` is required when changing the primary card. |
| `POST /api/boards/{boardId}/groups/{groupId}/move`    | Owner  | `{targetColumnId, placement, expectedRevision}`                | Revision and group.                                                                |
| `POST /api/boards/{boardId}/groups/{groupId}/ungroup` | Owner  | `{expectedRevision}`                                           | Revision and the restored top-level cards.                                         |

A new group contains 2–100 unique cards from one column. `primaryCardId` must be one of `cardIds`. A group title is `null` or 1–120 trimmed characters.

### Action items

| Method and path                                               | Access | Request                                                                              | Result                               |
| ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ | ------------------------------------ |
| `POST /api/boards/{boardId}/action-items`                     | Owner  | `{source: "manual", text, assignee?}` or `{source: "card", sourceCardId, assignee?}` | `201` with revision and action item. |
| `PATCH /api/boards/{boardId}/action-items/{actionItemId}`     | Owner  | One or more of `{text?, assignee?, completed?}`                                      | Revision and action item.            |
| `POST /api/boards/{boardId}/action-items/{actionItemId}/move` | Owner  | `{placement, expectedRevision}`                                                      | Revision and action item.            |
| `DELETE /api/boards/{boardId}/action-items/{actionItemId}`    | Owner  | `{expectedRevision}`                                                                 | Revision.                            |

Manual text contains 1–1000 trimmed characters. An action item created from a card copies that card's current text and stores a source reference. `assignee` is `null` or 1–120 trimmed characters. A board supports at most 200 action items.

Action-item placement uses `{beforeActionItemId, afterActionItemId}`, with a `null` neighbor at either edge.

### Invitations and memberships

| Method and path                                           | Access                            | Request                                            | Result                                                                             |
| --------------------------------------------------------- | --------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `POST /api/invitations/redeem`                            | Visitor cookie and raw invitation | `{token, displayName?}`                            | Membership details: board ID, membership ID, role, and display name.               |
| `GET /api/boards/{boardId}/invitations`                   | Owner                             | No body                                            | `{invitations}` with metadata, usage, and active state; never includes raw tokens. |
| `POST /api/boards/{boardId}/invitations`                  | Owner                             | Optional `{maxUses}`; an absent body uses defaults | `201` with ID, expiry, `maxUses`, and the only returned raw `joinPath`.            |
| `DELETE /api/boards/{boardId}/invitations/{invitationId}` | Owner                             | No body                                            | `204`; revokes an active participant invitation.                                   |
| `GET /api/boards/{boardId}/members`                       | Owner                             | No body                                            | Current owner membership ID and active participant list.                           |
| `DELETE /api/boards/{boardId}/members/{membershipId}`     | Owner                             | No body                                            | `204`; revokes an active participant membership.                                   |
| `PATCH /api/boards/{boardId}/membership`                  | Member                            | `{displayName}`                                    | Updated display name and board revision.                                           |
| `DELETE /api/boards/{boardId}/membership`                 | Participant                       | No body                                            | `204`; leaves the board. An owner must delete the board instead.                   |

Participant invitations default to one use and accept `maxUses` from 1 to 100. They normally expire after seven days or when the board expires, whichever comes first. The URL has the form `/join#token`; treat it as a bearer credential.

One session can own at most 20 active boards. A board supports at most 20 active participant invitations, 100 active participants, 500 lifetime participant-invitation rows, and 500 lifetime participant-membership rows; limit exhaustion returns `422`.

### Exports

| Method and path                         | Access | Result                                                                  |
| --------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `GET /api/boards/{boardId}/export.json` | Member | Downloadable JSON snapshot.                                             |
| `GET /api/boards/{boardId}/export.csv`  | Member | Downloadable UTF-8 CSV with BOM and spreadsheet-formula neutralization. |
| `GET /api/boards/{boardId}/export.md`   | Member | Downloadable escaped Markdown summary.                                  |

Exports contain the complete board state rather than paginated data and therefore have separate safety ceilings. An oversized board returns `422 BOARD_EXPORT_LIMIT_EXCEEDED`.

### Realtime events

`GET /api/boards/{boardId}/events` opens an SSE stream for a member. Clients may send the last fully applied decimal revision in `Last-Event-ID`.

The server emits:

```text
event: board.ready
data: {"boardId":"...","revision":"12"}

id: 13
event: board.invalidate
data: {"boardId":"...","revision":"13","type":"card.created"}
```

`board.invalidate` means "fetch authoritative state at or beyond this revision"; it does not carry the changed resource. If `Last-Event-ID` is behind the current state, the first invalidation has type `resync`. A `: heartbeat` comment is written every 12 seconds. Access is revalidated every 30 seconds, and the connection closes when access is lost or the PostgreSQL listener becomes unavailable.

Responses use `text/event-stream`, `Cache-Control: no-store, no-transform`, and `X-Accel-Buffering: no`. Proxies must not buffer, cache, or compress the stream.

### Health

`GET /api/health` is unauthenticated:

- `200 {"status":"ok"}` means runtime configuration validates, the process is not draining, and PostgreSQL answered a lightweight query within the health timeout.
- `503 {"status":"unavailable"}` means one of those checks failed.

Health does not prove that migrations are current, realtime `LISTEN` works, cleanup is succeeding, or backups are restorable.

## Revisions and concurrent changes

Ordering and destructive mutations include `expectedRevision`. Placement objects describe the item's intended neighbors. The server locks the board, checks the revision and placement, applies the change, increments the revision, and publishes a realtime invalidation in the same transaction.

A stale request normally receives:

```json
{
  "error": {
    "code": "STALE_BOARD_REVISION",
    "message": "...",
    "details": {
      "currentRevision": "13"
    }
  }
}
```

Refresh the board, rebuild the placement from the new state, and ask the user to retry where appropriate. Do not blindly replay a destructive request against a new revision.

## Errors

JSON errors have one stable shape within a given source revision:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "...",
    "details": {}
  }
}
```

`details` is optional and contains only safe structured information. Current error messages are user-interface text and may be localized; clients should branch on HTTP status and `error.code`, while still treating codes as version-specific because the API has no public compatibility promise.

Common statuses are:

| Status | Meaning                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------- |
| `400`  | Invalid UUID, query, cursor, JSON, content length, revision, or unexpected request body.                        |
| `401`  | Anonymous session is inactive on a flow where it is not masked as board-not-found.                              |
| `403`  | Wrong origin, owner/card-creator role required, or operation forbidden.                                         |
| `404`  | Board access is absent or the requested board-scoped resource is not visible.                                   |
| `409`  | Stale revision, read-only/disabled feature, duplicate legacy like, ownership state, or another domain conflict. |
| `413`  | Request body exceeds its configured limit.                                                                      |
| `415`  | A JSON endpoint did not receive `application/json`.                                                             |
| `422`  | A board, column, invitation, participant, vote, export, or history limit is exhausted.                          |
| `429`  | Request or stream limit exceeded. The response includes `Retry-After` when available.                           |
| `500`  | Unexpected internal failure with a generic response.                                                            |
| `503`  | PostgreSQL or realtime setup is temporarily unavailable.                                                        |

## Current rate limits

These values are implementation details, not a service-level guarantee. Normal visitor limits use a credential-derived identity. Trusted-IP limits are additional abuse caps and apply only when `TRUSTED_PROXY_HOPS` is nonzero and correctly configured.

| Operation scope                                | Visitor limit | Trusted-IP limit |     Window |
| ---------------------------------------------- | ------------: | ---------------: | ---------: |
| Create a board                                 |            10 |              100 | 10 minutes |
| Standard content mutation, per operation scope |            30 |              300 |   1 minute |
| Create or remove a vote                        |            20 |              200 |   1 minute |
| Board snapshot and item-page reads             |           120 |            1,200 |   1 minute |
| SSE handshakes                                 |            30 |              300 |   1 minute |
| Exports                                        |            10 |              100 |   1 minute |
| Redeem an invitation                           |            20 |              200 | 10 minutes |

Invitation/member management has route-specific visitor limits from 5 to 60 requests per minute. The deprecated like adapter allows 20 visitor requests and 200 trusted-IP requests per minute. A broad trusted-IP pre-auth cap of 3,000 requests per minute covers matched board and invitation routes.

Rate-limit counters are stored in PostgreSQL and shared across replicas. SSE additionally allows at most three concurrent streams for one board-scoped visitor identity in each application process; that concurrency cap is not global across replicas.

## Compatibility guidance

- Do not scrape the rendered HTML as an API.
- Do not manufacture or persist another user's visitor cookie.
- Do not decode cursors or assume database ordering fields remain unchanged.
- Do not infer access from a board UUID or from a prior successful response.
- Treat SSE as invalidation and always refresh authoritative state.
- Expect the UI and API to change atomically in future commits.
