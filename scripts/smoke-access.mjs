const baseUrl = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const canonicalOrigin = new URL(process.env.SMOKE_ORIGIN ?? baseUrl).origin;

const createClient = () => {
  let cookie = "";

  return async (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", canonicalOrigin);
    if (cookie) headers.set("Cookie", cookie);

    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";", 1)[0];
    return response;
  };
};

const expectStatus = async (response, expected, step) => {
  if (response.status === expected) return response;

  const body = await response.text();
  throw new Error(`${step}: expected ${expected}, received ${response.status}: ${body}`);
};

const readJson = async (response) => response.json();

const assertRevision = (value, step) => {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${step}: canonical revision missing`);
  }
  return value;
};

const assertRevisionAdvanced = (previous, next, step) => {
  assertRevision(next, step);
  if (BigInt(next) <= BigInt(previous)) {
    throw new Error(`${step}: revision did not advance`);
  }
  return next;
};

const parseSseBlock = (block) => {
  const data = [];
  let event = "message";
  let id = null;
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    if (field === "id") id = value;
    if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  return { event, id, data: JSON.parse(data.join("\n")) };
};

const openEventStreams = new Set();

const openBoardEventStream = async (client, boardId, lastEventId, step) => {
  const controller = new AbortController();
  const headers = lastEventId === undefined ? undefined : { "Last-Event-ID": lastEventId };
  const response = await expectStatus(
    await client(`/api/boards/${boardId}/events`, {
      headers,
      signal: controller.signal,
    }),
    200,
    step,
  );
  if (
    !response.headers.get("content-type")?.startsWith("text/event-stream")
    || response.headers.get("cache-control") !== "no-store, no-transform"
    || response.headers.get("x-accel-buffering") !== "no"
    || !response.body
  ) {
    controller.abort();
    throw new Error(`${step}: SSE headers or response body missing`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let closed = false;
  const readNext = async () => {
    while (true) {
      const boundary = buffer.search(/\r?\n\r?\n/);
      if (boundary >= 0) {
        const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + (match?.[0].length ?? 2));
        const event = parseSseBlock(block);
        if (event) return event;
        continue;
      }

      const result = await reader.read();
      if (result.done) return null;
      buffer += decoder.decode(result.value, { stream: true });
    }
  };
  const stream = {
    async next(expectedEvent, eventStep) {
      const event = await readNext();
      if (!event || event.event !== expectedEvent) {
        throw new Error(
          `${eventStep}: expected ${expectedEvent}, received ${event?.event ?? "stream close"}`,
        );
      }
      return event;
    },
    async waitForClose(timeoutMs, closeStep) {
      let timeout;
      try {
        await Promise.race([
          (async () => {
            while (await readNext()) {
              // Ignore queued invalidations and heartbeat comments until close.
            }
          })(),
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error(`${closeStep}: stream did not close in time`)),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      openEventStreams.delete(stream);
      controller.abort();
      await reader.cancel().catch(() => undefined);
    },
  };
  openEventStreams.add(stream);
  return stream;
};

const assertBoardEvent = (event, { boardId, revision, type }, step) => {
  if (
    event.id !== revision
    || event.data?.boardId !== boardId
    || event.data?.revision !== revision
    || event.data?.type !== type
    || Object.keys(event.data).sort().join(",") !== "boardId,revision,type"
  ) {
    throw new Error(`${step}: invalid board invalidation payload`);
  }
};

const parseInvitationToken = (invitation, step) => {
  const token = new URL(invitation.joinPath, baseUrl).hash.slice(1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error(`${step}: fragment token missing`);
  }
  return token;
};

const createInvitation = async (owner, boardId, step) => {
  const response = await expectStatus(
    await owner(`/api/boards/${boardId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    201,
    step,
  );
  return parseInvitationToken(await readJson(response), step);
};

const redeemInvitation = async (participant, token, displayName, step) => {
  const response = await expectStatus(
    await participant("/api/invitations/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, displayName }),
    }),
    200,
    step,
  );
  return readJson(response);
};

const owner = createClient();
const participant = createClient();
const outsider = createClient();
let boardId;

try {
  const requestedTitle = "Этап 3 realtime smoke";
  const created = await expectStatus(
    await owner("/api/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: requestedTitle }),
    }),
    201,
    "create board",
  );
  const createdBoard = await readJson(created);
  boardId = createdBoard.id;
  if (
    createdBoard.url !== `/boards/${boardId}`
    || createdBoard.title !== requestedTitle
    || createdBoard.revision !== "0"
  ) {
    throw new Error("create board: target metadata missing");
  }
  let revision = assertRevision(createdBoard.revision, "create board");

  await expectStatus(await outsider(`/api/boards/${boardId}`), 404, "deny UUID-only access");
  const ownerBoard = await expectStatus(
    await owner(`/api/boards/${boardId}`),
    200,
    "owner reads board",
  );
  const ownerSnapshot = await readJson(ownerBoard);
  if (
    ownerSnapshot.id !== boardId
    || ownerSnapshot.title !== requestedTitle
    || ownerSnapshot.viewer?.role !== "OWNER"
    || ownerSnapshot.capabilities?.canManageColumns !== true
    || ownerSnapshot.access !== undefined
  ) {
    throw new Error("owner reads board: target snapshot missing");
  }
  if (!Array.isArray(ownerSnapshot.columns) || ownerSnapshot.columns.length !== 2) {
    throw new Error("owner reads board: two initial dynamic columns missing");
  }
  for (const column of ownerSnapshot.columns) {
    if (
      typeof column.id !== "string"
      || typeof column.title !== "string"
      || typeof column.voteLimit !== "number"
      || !Array.isArray(column.items)
    ) {
      throw new Error("owner reads board: invalid dynamic column");
    }
  }
  revision = assertRevision(ownerSnapshot.revision, "owner reads board");
  const sourceColumn = ownerSnapshot.columns[0];
  const lastInitialColumn = ownerSnapshot.columns.at(-1);

  const createdColumnResponse = await expectStatus(
    await owner(`/api/boards/${boardId}/columns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Эксперименты",
        voteLimit: 3,
        placement: {
          beforeColumnId: lastInitialColumn.id,
          afterColumnId: null,
        },
        expectedRevision: revision,
      }),
    }),
    201,
    "owner creates a dynamic column",
  );
  const createdColumnResult = await readJson(createdColumnResponse);
  if (
    createdColumnResult.column?.title !== "Эксперименты"
    || createdColumnResult.column?.voteLimit !== 3
  ) {
    throw new Error("owner creates a dynamic column: target column missing");
  }
  revision = assertRevisionAdvanced(
    revision,
    createdColumnResult.revision,
    "owner creates a dynamic column",
  );
  const targetColumn = createdColumnResult.column;

  const firstToken = await createInvitation(owner, boardId, "create invitation");
  const firstMembership = await redeemInvitation(
    participant,
    firstToken,
    "Smoke participant",
    "redeem invitation",
  );
  if (firstMembership.role !== "PARTICIPANT" || firstMembership.boardId !== boardId) {
    throw new Error("redeem invitation: participant membership missing");
  }

  const participantBoard = await expectStatus(
    await participant(`/api/boards/${boardId}`),
    200,
    "participant reads board",
  );
  const participantSnapshot = await readJson(participantBoard);
  if (
    participantSnapshot.viewer?.role !== "PARTICIPANT"
    || participantSnapshot.capabilities?.canManageColumns !== false
    || participantSnapshot.revision !== revision
    || !Array.isArray(participantSnapshot.columns)
    || participantSnapshot.columns.some((column) => typeof column.id !== "string")
  ) {
    throw new Error("participant reads board: participant target snapshot missing");
  }

  await expectStatus(
    await outsider(`/api/boards/${boardId}/events`),
    404,
    "deny outsider realtime stream",
  );
  await expectStatus(
    await owner(`/api/boards/${boardId}/events`, {
      headers: { "Last-Event-ID": "-1" },
    }),
    400,
    "reject malformed realtime revision",
  );
  await expectStatus(
    await owner(`/api/boards/${boardId}/events`, {
      headers: { "Last-Event-ID": (BigInt(revision) + 100n).toString() },
    }),
    400,
    "reject future realtime revision",
  );

  const ownerEvents = await openBoardEventStream(
    owner,
    boardId,
    revision,
    "open owner realtime stream",
  );
  const participantEvents = await openBoardEventStream(
    participant,
    boardId,
    revision,
    "open participant realtime stream",
  );
  const [ownerReady, participantReady] = await Promise.all([
    ownerEvents.next("board.ready", "owner realtime ready"),
    participantEvents.next("board.ready", "participant realtime ready"),
  ]);
  for (const ready of [ownerReady, participantReady]) {
    if (
      ready.id !== null
      || ready.data?.boardId !== boardId
      || ready.data?.revision !== revision
      || Object.keys(ready.data).sort().join(",") !== "boardId,revision"
    ) {
      throw new Error("realtime ready: invalid handshake payload");
    }
  }

  const secondOwnerEvents = await openBoardEventStream(
    owner,
    boardId,
    revision,
    "open second owner realtime stream",
  );
  const thirdOwnerEvents = await openBoardEventStream(
    owner,
    boardId,
    revision,
    "open third owner realtime stream",
  );
  await Promise.all([
    secondOwnerEvents.next("board.ready", "second owner realtime ready"),
    thirdOwnerEvents.next("board.ready", "third owner realtime ready"),
  ]);
  const fourthOwnerStream = await expectStatus(
    await owner(`/api/boards/${boardId}/events`, {
      headers: { "Last-Event-ID": revision },
    }),
    429,
    "limit fourth owner realtime stream",
  );
  if (!fourthOwnerStream.headers.get("retry-after")) {
    throw new Error("limit fourth owner realtime stream: Retry-After missing");
  }
  await secondOwnerEvents.close();
  await thirdOwnerEvents.close();

  const createdCardResponse = await expectStatus(
    await participant(`/api/boards/${boardId}/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        columnId: sourceColumn.id,
        text: "Smoke card",
        author: "Smoke participant",
      }),
    }),
    201,
    "participant creates card",
  );
  const createdCardResult = await readJson(createdCardResponse);
  const card = createdCardResult.card;
  if (
    card?.columnId !== sourceColumn.id
    || card?.text !== "Smoke card"
    || card?.author !== "Smoke participant"
    || card?.viewerHasVoted !== false
  ) {
    throw new Error("participant creates card: target card missing");
  }
  revision = assertRevisionAdvanced(revision, createdCardResult.revision, "participant creates card");
  const [ownerCardEvent, participantCardEvent] = await Promise.all([
    ownerEvents.next("board.invalidate", "owner receives card invalidation"),
    participantEvents.next("board.invalidate", "participant receives card invalidation"),
  ]);
  assertBoardEvent(
    ownerCardEvent,
    { boardId, revision, type: "card.created" },
    "owner receives card invalidation",
  );
  assertBoardEvent(
    participantCardEvent,
    { boardId, revision, type: "card.created" },
    "participant receives card invalidation",
  );
  const participantAppliedRevision = revision;
  await participantEvents.close();

  const voteResponse = await expectStatus(
    await participant(`/api/boards/${boardId}/cards/${card.id}/vote`, { method: "PUT" }),
    200,
    "participant votes",
  );
  const vote = await readJson(voteResponse);
  if (vote.cardId !== card.id || vote.voteCount !== 1 || vote.viewerHasVoted !== true) {
    throw new Error("participant votes: authoritative vote state missing");
  }
  revision = assertRevisionAdvanced(revision, vote.revision, "participant votes");
  assertBoardEvent(
    await ownerEvents.next("board.invalidate", "owner receives vote invalidation"),
    { boardId, revision, type: "vote.updated" },
    "owner receives vote invalidation",
  );

  const unvoteResponse = await expectStatus(
    await participant(`/api/boards/${boardId}/cards/${card.id}/vote`, { method: "DELETE" }),
    200,
    "participant removes vote",
  );
  const unvote = await readJson(unvoteResponse);
  if (unvote.cardId !== card.id || unvote.voteCount !== 0 || unvote.viewerHasVoted !== false) {
    throw new Error("participant removes vote: authoritative vote state missing");
  }
  revision = assertRevisionAdvanced(revision, unvote.revision, "participant removes vote");
  assertBoardEvent(
    await ownerEvents.next("board.invalidate", "owner receives unvote invalidation"),
    { boardId, revision, type: "vote.updated" },
    "owner receives unvote invalidation",
  );

  const reconnectedParticipantEvents = await openBoardEventStream(
    participant,
    boardId,
    participantAppliedRevision,
    "reconnect participant realtime stream",
  );
  const resync = await reconnectedParticipantEvents.next(
    "board.invalidate",
    "participant receives reconnect resync",
  );
  assertBoardEvent(
    resync,
    { boardId, revision, type: "resync" },
    "participant receives reconnect resync",
  );

  const movedCardResponse = await expectStatus(
    await participant(`/api/boards/${boardId}/cards/${card.id}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetColumnId: targetColumn.id,
        placement: { before: null, after: null },
        expectedRevision: revision,
      }),
    }),
    200,
    "participant moves owned card",
  );
  const movedCard = await readJson(movedCardResponse);
  if (movedCard.card?.id !== card.id || movedCard.card?.columnId !== targetColumn.id) {
    throw new Error("participant moves owned card: target placement missing");
  }
  revision = assertRevisionAdvanced(revision, movedCard.revision, "participant moves owned card");

  const membersResponse = await expectStatus(
    await owner(`/api/boards/${boardId}/members`),
    200,
    "owner lists participants",
  );
  const members = (await readJson(membersResponse)).participants;
  if (members.length !== 1 || members[0].id !== firstMembership.membershipId) {
    throw new Error("owner lists participants: joined participant missing");
  }

  await expectStatus(
    await owner(`/api/boards/${boardId}/members/${firstMembership.membershipId}`, {
      method: "DELETE",
    }),
    204,
    "owner revokes participant",
  );
  await reconnectedParticipantEvents.waitForClose(
    35_000,
    "revoked participant realtime stream",
  );
  await reconnectedParticipantEvents.close();
  await expectStatus(
    await participant(`/api/boards/${boardId}`),
    404,
    "revoked participant is denied",
  );

  const rejoinToken = await createInvitation(owner, boardId, "create rejoin invitation");
  const secondMembership = await redeemInvitation(
    participant,
    rejoinToken,
    "Smoke participant rejoined",
    "redeem rejoin invitation",
  );
  if (
    secondMembership.role !== "PARTICIPANT"
    || secondMembership.boardId !== boardId
    || secondMembership.membershipId === firstMembership.membershipId
  ) {
    throw new Error("redeem rejoin invitation: new participant membership missing");
  }
  await expectStatus(
    await participant(`/api/boards/${boardId}`),
    200,
    "rejoined participant reads board",
  );

  await expectStatus(
    await participant(`/api/boards/${boardId}/membership`, { method: "DELETE" }),
    204,
    "participant leaves board",
  );
  await expectStatus(
    await participant(`/api/boards/${boardId}`),
    404,
    "participant is denied after leave",
  );

  await expectStatus(
    await owner(`/api/boards/${boardId}`, { method: "DELETE" }),
    204,
    "owner deletes board",
  );
  boardId = undefined;

  console.log(JSON.stringify({ ok: true }));
} catch (error) {
  if (boardId) {
    try {
      await expectStatus(
        await owner(`/api/boards/${boardId}`, { method: "DELETE" }),
        204,
        "cleanup board after failed smoke",
      );
    } catch (cleanupError) {
      console.error(
        cleanupError instanceof Error
          ? cleanupError.message
          : "cleanup board after failed smoke: unknown error",
      );
    }
  }
  console.error(error instanceof Error ? error.message : "Access smoke failed");
  process.exitCode = 1;
} finally {
  await Promise.all(
    Array.from(openEventStreams, (stream) => stream.close()),
  );
}
