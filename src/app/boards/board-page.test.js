import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("board page render only reads an existing visitor cookie", async () => {
  const source = await readFile(
    new URL("./[boardId]/page.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /next\/headers/);
  assert.match(source, /getExistingVisitorToken/);
  assert.doesNotMatch(source, /getOrSetVisitorToken/);
  assert.doesNotMatch(source, /cookies\s*\(/);
});

test("board page render loads the target snapshot with a board-scoped identity", async () => {
  const source = await readFile(
    new URL("./[boardId]/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /deriveContentVisitorIdentity/);
  assert.match(source, /getTargetBoardSnapshot/);
  assert.doesNotMatch(source, /services\/boards-service/);
  assert.doesNotMatch(source, /\bgetBoard\s*\(/);
});

test("board client uses dynamic column pages and explicit authoritative votes", async () => {
  const boardClient = await readFile(
    new URL("../../components/board-page-client.tsx", import.meta.url),
    "utf8",
  );
  const boardColumns = await readFile(
    new URL("../../components/board/board-columns.tsx", import.meta.url),
    "utf8",
  );

  assert.match(boardClient, /new URLSearchParams\(\{ columnId, cursor \}\)/);
  assert.match(boardClient, /cards\/\$\{cardId\}\/vote/);
  assert.match(boardClient, /method: viewerHasVoted \? "DELETE" : "PUT"/);
  assert.match(boardColumns, /remainingVotesByColumn/);
  assert.match(boardColumns, /actionItems/);
  assert.doesNotMatch(`${boardClient}\n${boardColumns}`, /localStorage/);
});

test("board client uses SSE invalidation with 30-second reconciliation fallback", async () => {
  const boardClient = await readFile(
    new URL("../../components/board-page-client.tsx", import.meta.url),
    "utf8",
  );
  const realtimeHook = await readFile(
    new URL("../../components/use-board-realtime.ts", import.meta.url),
    "utf8",
  );

  assert.match(boardClient, /useBoardRealtime/);
  assert.match(realtimeHook, /\/events/);
  assert.match(realtimeHook, /"Last-Event-ID": appliedRevisionRef\.current/);
  assert.match(realtimeHook, /RECONCILIATION_INTERVAL_MS = 30_000/);
  assert.match(realtimeHook, /getReconnectDelayMs/);
  assert.doesNotMatch(boardClient, /setInterval\(\(\) => void load\(\), 8000\)/);
});

test("board shell declares mobile viewport and safe-area boundaries", async () => {
  const layout = await readFile(new URL("../layout.tsx", import.meta.url), "utf8");
  const toolbar = await readFile(
    new URL("../../components/board/board-toolbar.tsx", import.meta.url),
    "utf8",
  );
  const columns = await readFile(
    new URL("../../components/board/board-columns.tsx", import.meta.url),
    "utf8",
  );
  const management = await readFile(
    new URL("../../components/board/board-management-panel.tsx", import.meta.url),
    "utf8",
  );
  const dialog = await readFile(
    new URL("../../components/ui/dialog.tsx", import.meta.url),
    "utf8",
  );
  const toaster = await readFile(
    new URL("../../components/ui/sonner.tsx", import.meta.url),
    "utf8",
  );

  assert.match(layout, /viewportFit: "cover"/);
  assert.match(layout, /interactiveWidget: "resizes-content"/);
  for (const source of [toolbar, columns, management, dialog, toaster]) {
    assert.match(source, /safe-area-inset/);
  }
});

test("board canvas keeps its edge padding inside the scroll snap viewport", async () => {
  const columns = await readFile(
    new URL("../../components/board/board-columns.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    columns,
    /\[scroll-padding-inline-start:calc\(1rem\+env\(safe-area-inset-left\)\)\]/,
  );
  assert.match(
    columns,
    /\[scroll-padding-inline-end:calc\(1rem\+env\(safe-area-inset-right\)\)\]/,
  );
  assert.match(
    columns,
    /sm:\[scroll-padding-inline-start:calc\(1\.5rem\+env\(safe-area-inset-left\)\)\]/,
  );
  assert.match(
    columns,
    /sm:\[scroll-padding-inline-end:calc\(1\.5rem\+env\(safe-area-inset-right\)\)\]/,
  );
});

test("Stage 4 uses the current dnd-kit React API with accessible input modes", async () => {
  const boardClient = await readFile(
    new URL("../../components/board-page-client.tsx", import.meta.url),
    "utf8",
  );
  const boardColumns = await readFile(
    new URL("../../components/board/board-columns.tsx", import.meta.url),
    "utf8",
  );
  const packageJson = JSON.parse(await readFile(
    new URL("../../../package.json", import.meta.url),
    "utf8",
  ));

  assert.equal(packageJson.dependencies["@dnd-kit/react"], "^0.5.0");
  assert.equal(packageJson.dependencies["@dnd-kit/dom"], "^0.5.0");
  assert.equal(packageJson.dependencies["@dnd-kit/helpers"], "^0.5.0");
  assert.equal(packageJson.dependencies["@dnd-kit/abstract"], "^0.5.0");
  assert.equal(packageJson.dependencies["@dnd-kit/core"], undefined);
  assert.match(boardClient, /DragDropProvider/);
  assert.match(boardClient, /DragOverlay/);
  assert.match(boardColumns, /useSortable/);
  assert.match(boardClient, /PointerActivationConstraints\.Distance/);
  assert.match(boardClient, /PointerActivationConstraints\.Delay/);
  assert.match(boardClient, /value: 220/);
  assert.match(boardClient, /tolerance: \{ x: 8, y: 8 \}/);
  assert.match(boardClient, /AutoScroller\.configure/);
  assert.match(boardClient, /Accessibility\.configure/);
  assert.match(boardColumns, /CollisionPriority\.Low/);
  assert.match(boardClient, /moveDndItems/);
  assert.match(boardClient, /event\.preventDefault\(\)/);
  assert.match(boardClient, /pendingDragRefresh/);
  assert.match(boardClient, /dragPreviewTargetId/);
  assert.doesNotMatch(
    boardClient,
    /preview = moveBoardItemsForDrag\(preview, event\)/,
  );
  assert.match(boardClient, /load\(\{ force: true \}\)/);
  assert.match(boardClient, /aria-live="polite"/);
  assert.match(boardClient, /createBoardAccessibility = \(t: Translate\)/);
  assert.match(boardClient, /draggable: t\("boardShell\.dnd\.instructions"\)/);
  assert.doesNotMatch(boardClient, /const BOARD_ACCESSIBILITY/);
  assert.match(boardClient, /setBoard\(optimistic\)/);
  assert.match(boardClient, /setBoard\(previous\)/);
  assert.doesNotMatch(boardClient, /toast\.success\(successMessage\)/);
  assert.doesNotMatch(boardClient, /[А-Яа-яЁё]/);
  assert.match(
    boardColumns,
    /ref=\{board\.capabilities\.canManageColumns \? ref : targetRef\}/,
  );
  assert.match(boardColumns, /ref=\{canMove \? ref : targetRef\}/);
  assert.match(boardColumns, /ref=\{canManage \? ref : targetRef\}/);
});

test("Stage 4 exposes every product management flow in the board UI", async () => {
  const boardClient = await readFile(
    new URL("../../components/board-page-client.tsx", import.meta.url),
    "utf8",
  );
  const settingsPanel = await readFile(
    new URL("../../components/board-settings-panel.tsx", import.meta.url),
    "utf8",
  );
  const contentControls = await readFile(
    new URL("../../components/board-content-controls.tsx", import.meta.url),
    "utf8",
  );
  const boardColumns = await readFile(
    new URL("../../components/board/board-columns.tsx", import.meta.url),
    "utf8",
  );
  const managementPanel = await readFile(
    new URL("../../components/board/board-management-panel.tsx", import.meta.url),
    "utf8",
  );
  const boardToolbar = await readFile(
    new URL("../../components/board/board-toolbar.tsx", import.meta.url),
    "utf8",
  );
  const quickColumnDialog = await readFile(
    new URL("../../components/board/quick-column-dialog.tsx", import.meta.url),
    "utf8",
  );
  const actionItemComposer = await readFile(
    new URL("../../components/board/action-item-composer.tsx", import.meta.url),
    "utf8",
  );

  assert.match(boardClient, /BoardManagementPanel/);
  assert.match(managementPanel, /BoardSettingsContent/);
  assert.match(managementPanel, /BoardAccessContent/);
  assert.match(managementPanel, /LanguageSwitcher/);
  assert.equal(
    (managementPanel.match(/value: "interface"/g) ?? []).length,
    2,
    "Interface navigation must be available to owners and participants",
  );
  assert.match(managementPanel, /<InterfaceSection \/>/);
  assert.match(boardColumns, /CardMenu/);
  assert.match(boardColumns, /GroupCardsDialog/);
  assert.match(boardColumns, /ActionItemMenu/);
  assert.match(boardColumns, /group\.cards\.map[\s\S]*?<CardMenu/);
  assert.match(boardColumns, /content\.column\.actions/);
  assert.match(boardColumns, /content\.group\.combine/);
  assert.match(boardColumns, /content\.column\.configure/);
  assert.match(boardColumns, /onManageColumn\(column\.id\)/);
  assert.match(boardToolbar, /QuickColumnDialog/);
  assert.match(boardToolbar, /boardShell\.toolbar\.addColumn/);
  assert.match(quickColumnDialog, /expectedRevision: board\.revision/);
  assert.match(quickColumnDialog, /beforeColumnId: previousColumn\?\.id/);
  assert.match(
    quickColumnDialog,
    /normalizedVoteLimitInput\.length === 0/,
  );
  assert.match(quickColumnDialog, /onChanged\(\{ force: true \}\)/);
  assert.match(quickColumnDialog, /BigInt\(mutationRevision\)/);
  assert.match(settingsPanel, /input\.scrollIntoView/);
  assert.match(boardClient, /\/columns\/\$\{parsedSource\.columnId\}\/move/);
  assert.match(boardClient, /\/\$\{resource\}\/\$\{parsedSource\.item\.id\}\/move/);
  assert.match(boardClient, /\/action-items\/\$\{parsedSource\.actionItemId\}\/move/);

  assert.match(settingsPanel, /cardsEnabled/);
  assert.match(settingsPanel, /votingEnabled/);
  assert.match(settingsPanel, /readOnly/);
  assert.match(settingsPanel, /moveCards/);
  assert.match(settingsPanel, /deleteCards/);
  assert.match(settingsPanel, /const wasOpen = useRef\(false\)/);
  assert.doesNotMatch(settingsPanel, /export const BoardSettingsPanel/);
  assert.match(
    settingsPanel,
    /!selectedDeleteColumnIsEmpty && !board\.settings\.cardsEnabled/,
  );
  assert.match(settingsPanel, /RESET_VOTES/);

  assert.match(contentControls, /method: "PATCH"/);
  assert.match(contentControls, /method: "DELETE"/);
  assert.match(contentControls, /source: "card"/);
  assert.match(actionItemComposer, /source: "manual"/);
  assert.match(contentControls, /\/ungroup/);
  assert.doesNotMatch(contentControls, /export const CreateActionItemDialog/);
});
