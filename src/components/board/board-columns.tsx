"use client";

import { CollisionPriority } from "@dnd-kit/abstract";
import { useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import {
  Ellipsis,
  GripVertical,
  Layers3,
  Loader2,
  Settings2,
  ThumbsUp,
} from "lucide-react";
import { useRef, useState } from "react";
import { CardComposer } from "@/components/board/card-composer";
import {
  ActionItemCompletionControl,
  ActionItemComposer,
  ActionItemMenu,
  CardMenu,
  GroupCardsDialog,
  GroupMenu,
} from "@/components/board-content-controls";
import { boardDndIds } from "@/components/board-dnd";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/provider";
import type { Translate } from "@/i18n/translate";
import { getGroupDisplayTitle } from "@/lib/group-display";
import type {
  ActionItemView,
  BoardItem,
  BoardSnapshot,
  CardView,
  GroupView,
} from "@/lib/pagination/board-state";
import { cn } from "@/lib/utils";

type SnapshotColumn = BoardSnapshot["columns"][number];
type ActionError = { key: string; message: string } | null;

const DND_TYPES = {
  column: "BOARD_COLUMN",
  item: "BOARD_ITEM",
  action: "BOARD_ACTION",
} as const;

const COLUMN_GROUP = "BOARD_COLUMNS";
const ACTION_GROUP = "BOARD_ACTIONS";
const itemGroup = (columnId: string) => boardDndIds.columnDrop(columnId);

const COLUMN_STYLES = [
  {
    marker: "bg-blue-500",
  },
  {
    marker: "bg-violet-500",
  },
  {
    marker: "bg-teal-500",
  },
  {
    marker: "bg-amber-500",
  },
] as const;

const itemRef = (item: BoardItem) =>
  ({ kind: item.kind, id: item.id }) as const;

const itemLabel = (item: BoardItem, t: Translate): string =>
  item.kind === "CARD"
    ? t("content.card.itemLabel", { text: item.text.slice(0, 80) })
    : t("content.group.itemLabel", {
        title: getGroupDisplayTitle(item) ?? t("content.group.unnamed"),
      });

const itemMoveLabel = (item: BoardItem, t: Translate): string =>
  item.kind === "CARD"
    ? t("content.card.moveLabel", { text: item.text.slice(0, 80) })
    : t("content.group.moveLabel", {
        title: getGroupDisplayTitle(item) ?? t("content.group.unnamed"),
      });

const actionLabel = (item: ActionItemView, t: Translate): string =>
  t("content.action.itemLabel", { text: item.text.slice(0, 80) });

const relativeDateParts = (
  value: string,
): { value: number; unit: Intl.RelativeTimeFormatUnit } => {
  const difference = new Date(value).getTime() - Date.now();
  const absoluteDifference = Math.abs(difference);
  if (absoluteDifference >= 86_400_000) {
    return { value: Math.round(difference / 86_400_000), unit: "day" };
  }
  if (absoluteDifference >= 3_600_000) {
    return { value: Math.round(difference / 3_600_000), unit: "hour" };
  }
  return { value: Math.round(difference / 60_000), unit: "minute" };
};

export type BoardColumnsProps = {
  boardId: string;
  board: BoardSnapshot;
  onCreateCard: (
    columnId: string,
    text: string,
    author: string | null,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  onToggleVote: (cardId: string, viewerHasVoted: boolean) => Promise<void>;
  onLoadMore: (columnId: string) => Promise<void>;
  onChanged: () => Promise<unknown>;
  loadingKey: string | null;
  actionError: ActionError;
  loadingMore: Readonly<Record<string, boolean>>;
  loadMoreErrors: Readonly<Record<string, string | null>>;
  disabled: boolean;
  onManageColumn: (columnId: string) => void;
};

export const BoardColumns = ({
  boardId,
  board,
  onCreateCard,
  onToggleVote,
  onLoadMore,
  onChanged,
  loadingKey,
  actionError,
  loadingMore,
  loadMoreErrors,
  disabled,
  onManageColumn,
}: BoardColumnsProps) => {
  const { t } = useI18n();

  return (
    <section
      aria-labelledby="board-columns-heading"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <h2 id="board-columns-heading" className="sr-only">
        {t("content.column.boardHeading")}
      </h2>
      <ol
        data-testid="board-canvas"
        className="flex min-h-0 min-w-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pt-3 pr-[calc(1rem+env(safe-area-inset-right))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] pl-[calc(1rem+env(safe-area-inset-left))] [scroll-padding-inline-end:calc(1rem+env(safe-area-inset-right))] [scroll-padding-inline-start:calc(1rem+env(safe-area-inset-left))] [scrollbar-gutter:stable] sm:pt-4 sm:pr-[calc(1.5rem+env(safe-area-inset-right))] sm:pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pl-[calc(1.5rem+env(safe-area-inset-left))] sm:[scroll-padding-inline-end:calc(1.5rem+env(safe-area-inset-right))] sm:[scroll-padding-inline-start:calc(1.5rem+env(safe-area-inset-left))]"
      >
        {board.columns.map((column, index) => (
          <SortableColumn
            key={column.id}
            boardId={boardId}
            board={board}
            column={column}
            index={index}
            toneIndex={index}
            onCreateCard={onCreateCard}
            onToggleVote={onToggleVote}
            onLoadMore={onLoadMore}
            onChanged={onChanged}
            loadingKey={loadingKey}
            actionError={actionError}
            loadingMore={loadingMore[column.id] ?? false}
            loadMoreError={loadMoreErrors[column.id] ?? null}
            disabled={disabled}
            onManageColumn={onManageColumn}
          />
        ))}
        <ActionItemsColumn
          boardId={boardId}
          board={board}
          onChanged={onChanged}
          disabled={disabled}
        />
      </ol>
    </section>
  );
};

const SortableColumn = ({
  boardId,
  board,
  column,
  index,
  toneIndex,
  onCreateCard,
  onToggleVote,
  onLoadMore,
  onChanged,
  loadingKey,
  actionError,
  loadingMore,
  loadMoreError,
  disabled,
  onManageColumn,
}: {
  boardId: string;
  board: BoardSnapshot;
  column: SnapshotColumn;
  index: number;
  toneIndex: number;
  onCreateCard: (
    columnId: string,
    text: string,
    author: string | null,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  onToggleVote: (cardId: string, viewerHasVoted: boolean) => Promise<void>;
  onLoadMore: (columnId: string) => Promise<void>;
  onChanged: () => Promise<unknown>;
  loadingKey: string | null;
  actionError: ActionError;
  loadingMore: boolean;
  loadMoreError: string | null;
  disabled: boolean;
  onManageColumn: (columnId: string) => void;
}) => {
  const { formatNumber, t } = useI18n();
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const columnMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const { ref, targetRef, handleRef, isDragSource, isDropTarget } = useSortable(
    {
      id: boardDndIds.column(column.id),
      index,
      group: COLUMN_GROUP,
      type: DND_TYPES.column,
      accept: DND_TYPES.column,
      data: { label: t("content.column.region", { column: column.title }) },
      disabled: {
        draggable: disabled || !board.capabilities.canManageColumns,
        droppable: disabled || !board.capabilities.canManageColumns,
      },
    },
  );
  const style = COLUMN_STYLES[toneIndex % COLUMN_STYLES.length];
  const topLevelCards = column.items.filter(
    (item): item is CardView => item.kind === "CARD",
  );
  const remainingVotes = board.remainingVotesByColumn[column.id] ?? 0;

  return (
    <li
      ref={board.capabilities.canManageColumns ? ref : targetRef}
      aria-label={t("content.column.region", { column: column.title })}
      className={cn(
        "h-full min-h-0 w-[calc(100vw-3rem-env(safe-area-inset-left)-env(safe-area-inset-right))] max-w-[23.75rem] shrink-0 snap-start transition-opacity sm:w-[21rem] lg:w-[min(23.75rem,calc((100vw-6rem)/3))]",
        isDragSource && "opacity-35",
      )}
    >
      <section
        role="region"
        aria-labelledby={`column-heading-${column.id}`}
        className={cn(
          "flex h-full min-h-[28rem] flex-col overflow-hidden rounded-[10px] border bg-card",
          isDropTarget && "border-primary/50 ring-2 ring-primary/15",
        )}
      >
        <header className="border-b px-3 py-3">
          <div className="flex min-w-0 items-start gap-2">
            <span
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                style.marker,
              )}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-start gap-2">
                <h3
                  id={`column-heading-${column.id}`}
                  className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-[15px] leading-5 font-semibold"
                >
                  {column.title}
                </h3>
                <span
                  className="inline-flex min-w-6 shrink-0 justify-center rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground"
                  aria-label={t("content.column.count", {
                    count: column.totalCount,
                    formattedCount: formatNumber(column.totalCount),
                  })}
                >
                  {formatNumber(column.totalCount)}
                </span>
              </div>
              <p
                className="mt-1 truncate text-xs text-muted-foreground"
                aria-label={
                  !board.capabilities.canVote
                    ? t("content.vote.unavailable")
                    : column.voteLimit === 0
                      ? t("content.vote.disabled")
                      : t("content.vote.remaining", {
                          count: remainingVotes,
                          remaining: formatNumber(remainingVotes),
                          limit: formatNumber(column.voteLimit),
                        })
                }
              >
                {!board.capabilities.canVote
                  ? t("content.vote.unavailable")
                  : column.voteLimit === 0
                    ? t("content.vote.disabled")
                    : t("content.vote.summary", {
                        remaining: formatNumber(remainingVotes),
                        limit: formatNumber(column.voteLimit),
                      })}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {board.capabilities.canManageGroups ||
              board.capabilities.canManageColumns ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      ref={columnMenuTriggerRef}
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9 text-muted-foreground max-sm:size-11"
                      aria-label={t("content.column.actions", {
                        column: column.title,
                      })}
                      disabled={disabled}
                    >
                      <Ellipsis className="size-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {board.capabilities.canManageGroups ? (
                      <DropdownMenuItem
                        disabled={
                          disabled ||
                          column.nextCursor !== null ||
                          topLevelCards.length < 2
                        }
                        onSelect={() => setGroupDialogOpen(true)}
                      >
                        <Layers3 className="size-4" aria-hidden="true" />
                        {t("content.group.combine")}
                      </DropdownMenuItem>
                    ) : null}
                    {board.capabilities.canManageColumns ? (
                      <DropdownMenuItem
                        onSelect={() => onManageColumn(column.id)}
                      >
                        <Settings2 className="size-4" aria-hidden="true" />
                        {t("content.column.configure")}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {board.capabilities.canManageColumns ? (
                <DragHandle
                  ref={handleRef}
                  label={t("content.column.move", { column: column.title })}
                  disabled={disabled}
                />
              ) : null}
            </div>
          </div>
          {column.nextCursor !== null ? (
            <p className="mt-2 text-xs text-amber-800">
              {t("content.column.incompleteOrder")}
            </p>
          ) : null}
        </header>
        {board.capabilities.canManageGroups ? (
          <GroupCardsDialog
            boardId={boardId}
            columnId={column.id}
            cards={topLevelCards}
            revision={board.revision}
            disabled={disabled || column.nextCursor !== null}
            open={groupDialogOpen}
            onOpenChange={setGroupDialogOpen}
            hideTrigger
            returnFocusRef={columnMenuTriggerRef}
            onChanged={onChanged}
          />
        ) : null}
        <ColumnContent
          boardId={boardId}
          board={board}
          column={column}
          onCreateCard={onCreateCard}
          onToggleVote={onToggleVote}
          onLoadMore={onLoadMore}
          onChanged={onChanged}
          loadingKey={loadingKey}
          actionError={actionError}
          loadingMore={loadingMore}
          loadMoreError={loadMoreError}
          disabled={disabled}
        />
      </section>
    </li>
  );
};

const ColumnContent = ({
  boardId,
  board,
  column,
  onCreateCard,
  onToggleVote,
  onLoadMore,
  onChanged,
  loadingKey,
  actionError,
  loadingMore,
  loadMoreError,
  disabled,
}: {
  boardId: string;
  board: BoardSnapshot;
  column: SnapshotColumn;
  onCreateCard: (
    columnId: string,
    text: string,
    author: string | null,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  onToggleVote: (cardId: string, viewerHasVoted: boolean) => Promise<void>;
  onLoadMore: (columnId: string) => Promise<void>;
  onChanged: () => Promise<unknown>;
  loadingKey: string | null;
  actionError: ActionError;
  loadingMore: boolean;
  loadMoreError: string | null;
  disabled: boolean;
}) => {
  const { formatNumber, t } = useI18n();
  const listDndDisabled = disabled || column.nextCursor !== null;
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: boardDndIds.columnDrop(column.id),
    type: `${DND_TYPES.item}_CONTAINER`,
    accept: DND_TYPES.item,
    collisionPriority: CollisionPriority.Low,
    data: {
      label: t("content.column.list", { column: column.title }),
      columnId: column.id,
    },
    disabled: listDndDisabled,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {board.capabilities.canCreateCards ? (
        <CardComposer
          columnId={column.id}
          columnTitle={column.title}
          pending={loadingKey !== null}
          onCreate={onCreateCard}
        />
      ) : null}

      <ol
        ref={dropRef}
        aria-labelledby={`column-heading-${column.id}`}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto pr-0.5 outline-none transition-colors",
          isDropTarget && "bg-primary/5 ring-2 ring-primary/20 ring-inset",
        )}
      >
        {loadingKey === `create:${column.id}` && column.items.length === 0 ? (
          <li className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-4/5" />
          </li>
        ) : null}
        {column.items.length === 0 && loadingKey !== `create:${column.id}` ? (
          <li className="flex min-h-20 items-center justify-center px-4 py-6 text-center text-sm text-muted-foreground">
            {t("content.column.empty")}
          </li>
        ) : null}
        {column.items.map((item, index) => (
          <SortableBoardItem
            key={`${item.kind}:${item.id}`}
            boardId={boardId}
            board={board}
            column={column}
            item={item}
            index={index}
            onToggleVote={onToggleVote}
            onChanged={onChanged}
            loadingKey={loadingKey}
            actionError={actionError}
            disabled={listDndDisabled}
          />
        ))}
        {column.nextCursor ? (
          <li className="space-y-2 pt-1 text-center">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              aria-label={t("content.column.loadMoreLabel", {
                column: column.title,
              })}
              aria-describedby={
                loadMoreError ? `load-more-error-${column.id}` : undefined
              }
              disabled={loadingMore}
              onClick={() => void onLoadMore(column.id)}
            >
              {loadingMore ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("content.column.loadMore")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t("content.column.shownCount", {
                shown: formatNumber(column.items.length),
                total: formatNumber(column.totalCount),
              })}
            </p>
          </li>
        ) : null}
        {loadMoreError ? (
          <li
            id={`load-more-error-${column.id}`}
            role="alert"
            className="text-sm text-destructive"
          >
            {loadMoreError}
          </li>
        ) : null}
      </ol>
    </div>
  );
};

const DragHandle = ({
  ref,
  label,
  disabled,
}: {
  ref: (element: Element | null) => void;
  label: string;
  disabled: boolean;
}) => {
  const { t } = useI18n();
  return (
    <Button
      ref={ref}
      type="button"
      size="icon"
      variant="ghost"
      disabled={disabled}
      aria-label={label}
      aria-describedby="board-dnd-instructions"
      title={t("content.dnd.handleHint", { label })}
      className="size-9 cursor-grab touch-none text-muted-foreground active:cursor-grabbing max-sm:size-11"
    >
      <GripVertical className="size-4" />
    </Button>
  );
};

const SortableBoardItem = ({
  boardId,
  board,
  column,
  item,
  index,
  onToggleVote,
  onChanged,
  loadingKey,
  actionError,
  disabled,
}: {
  boardId: string;
  board: BoardSnapshot;
  column: SnapshotColumn;
  item: BoardItem;
  index: number;
  onToggleVote: (cardId: string, viewerHasVoted: boolean) => Promise<void>;
  onChanged: () => Promise<unknown>;
  loadingKey: string | null;
  actionError: ActionError;
  disabled: boolean;
}) => {
  const { formatDate, formatRelativeTime, t } = useI18n();
  const canMove = item.canMove;
  const { ref, targetRef, handleRef, isDragSource, isDropTarget } = useSortable(
    {
      id: boardDndIds.item(itemRef(item)),
      index,
      group: itemGroup(column.id),
      type: DND_TYPES.item,
      accept: DND_TYPES.item,
      data: {
        label: itemLabel(item, t),
        columnId: column.id,
        itemKind: item.kind,
      },
      disabled: {
        draggable: disabled || !canMove,
        droppable: disabled,
      },
    },
  );

  // A disabled draggable without a handle makes dnd-kit put aria-disabled on
  // the whole item. Keep it registered only as a drop target so nested form
  // and vote controls remain available to assistive technology.
  return (
    <li
      ref={canMove ? ref : targetRef}
      aria-label={itemLabel(item, t)}
      className={cn(
        "rounded-lg border bg-card p-3 transition-[border-color,background-color,opacity] hover:border-border/80 hover:bg-secondary/25",
        isDragSource && "opacity-30",
        isDropTarget && "border-primary/40 ring-2 ring-primary/15",
      )}
    >
      {item.kind === "CARD" ? (
        <CardItemContent card={item} />
      ) : (
        <GroupItemContent
          boardId={boardId}
          revision={board.revision}
          group={item}
          canManageActionItems={board.capabilities.canManageActionItems}
          canVote={board.capabilities.canVote}
          voteLimit={column.voteLimit}
          remainingVotes={board.remainingVotesByColumn[column.id] ?? 0}
          onToggleVote={onToggleVote}
          onChanged={onChanged}
          loadingKey={loadingKey}
          actionError={actionError}
        />
      )}
      <div className="mt-3 flex min-w-0 items-center gap-1 border-t pt-2">
        <VoteButton
          cardId={item.kind === "CARD" ? item.id : item.primaryCardId}
          voteLabel={
            item.kind === "CARD"
              ? t("content.vote.voteForCard", { text: item.text })
              : t("content.vote.voteForGroup", {
                  title:
                    getGroupDisplayTitle(item) ?? t("content.group.unnamed"),
                })
          }
          removeVoteLabel={
            item.kind === "CARD"
              ? t("content.vote.removeVoteFromCard", { text: item.text })
              : t("content.vote.removeVoteFromGroup", {
                  title:
                    getGroupDisplayTitle(item) ?? t("content.group.unnamed"),
                })
          }
          voteCount={item.voteCount}
          viewerHasVoted={item.viewerHasVoted}
          canVote={board.capabilities.canVote}
          voteLimit={column.voteLimit}
          remainingVotes={board.remainingVotesByColumn[column.id] ?? 0}
          onToggleVote={onToggleVote}
          loadingKey={loadingKey}
          actionError={actionError}
        />
        <time
          dateTime={item.createdAt}
          title={formatDate(item.createdAt, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
          suppressHydrationWarning
          className="ml-1 min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
        >
          {(() => {
            const relative = relativeDateParts(item.createdAt);
            return formatRelativeTime(relative.value, relative.unit);
          })()}
        </time>
        {canMove ? (
          <DragHandle
            ref={handleRef}
            label={itemMoveLabel(item, t)}
            disabled={disabled}
          />
        ) : null}
        {item.kind === "CARD" ? (
          <CardMenu
            boardId={boardId}
            card={item}
            revision={board.revision}
            canManageActionItems={board.capabilities.canManageActionItems}
            disabled={loadingKey !== null}
            onChanged={onChanged}
          />
        ) : (
          <GroupMenu
            boardId={boardId}
            group={item}
            revision={board.revision}
            canManageActionItems={board.capabilities.canManageActionItems}
            disabled={loadingKey !== null}
            onChanged={onChanged}
          />
        )}
      </div>
    </li>
  );
};

const CardText = ({ card }: { card: CardView }) => {
  const { t } = useI18n();
  return (
    <>
      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-6 text-foreground/95">
        {card.text}
      </p>
      {card.author ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">
            {t("content.card.authorLabel")}
          </span>{" "}
          {card.author}
        </p>
      ) : null}
    </>
  );
};

const VoteButton = ({
  cardId,
  voteLabel,
  removeVoteLabel,
  voteCount,
  viewerHasVoted,
  canVote,
  voteLimit,
  remainingVotes,
  onToggleVote,
  loadingKey,
  actionError,
}: {
  cardId: string;
  voteLabel: string;
  removeVoteLabel: string;
  voteCount: number;
  viewerHasVoted: boolean;
  canVote: boolean;
  voteLimit: number;
  remainingVotes: number;
  onToggleVote: (cardId: string, viewerHasVoted: boolean) => Promise<void>;
  loadingKey: string | null;
  actionError: ActionError;
}) => {
  const { formatNumber, t } = useI18n();
  const key = `vote:${cardId}`;
  const canToggle =
    canVote && voteLimit > 0 && (viewerHasVoted || remainingVotes > 0);
  const disabledReason = !canVote
    ? t("content.vote.unavailableDescription")
    : voteLimit === 0
      ? t("content.vote.disabledDescription")
      : !viewerHasVoted && remainingVotes === 0
        ? t("content.vote.limitReached")
        : null;
  const descriptionId =
    actionError?.key === key
      ? `vote-error-${cardId}`
      : disabledReason
        ? `vote-hint-${cardId}`
        : undefined;

  return (
    <div className="space-y-1">
      <Button
        type="button"
        aria-label={viewerHasVoted ? removeVoteLabel : voteLabel}
        aria-pressed={viewerHasVoted}
        aria-describedby={descriptionId}
        title={disabledReason ?? undefined}
        onClick={() => void onToggleVote(cardId, viewerHasVoted)}
        disabled={!canToggle || loadingKey !== null}
        variant="outline"
        size="sm"
        className={cn(
          "h-9 min-w-12 px-2.5 max-sm:h-11",
          viewerHasVoted &&
            "border-primary bg-primary/10 text-primary hover:bg-primary/15",
        )}
      >
        {loadingKey === key ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ThumbsUp
            className={cn("size-4", viewerHasVoted && "fill-current")}
          />
        )}
        <span>{formatNumber(voteCount)}</span>
      </Button>
      {actionError?.key === key ? (
        <p
          id={`vote-error-${cardId}`}
          role="alert"
          className="text-xs text-destructive"
        >
          {actionError.message}
        </p>
      ) : null}
      {disabledReason ? (
        <p id={`vote-hint-${cardId}`} className="sr-only">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
};

const CardItemContent = ({ card }: { card: CardView }) => (
  <CardText card={card} />
);

const GroupItemContent = ({
  boardId,
  revision,
  group,
  canManageActionItems,
  canVote,
  voteLimit,
  remainingVotes,
  onToggleVote,
  onChanged,
  loadingKey,
  actionError,
}: {
  boardId: string;
  revision: string;
  group: GroupView;
  canManageActionItems: boolean;
  canVote: boolean;
  voteLimit: number;
  remainingVotes: number;
  onToggleVote: (cardId: string, viewerHasVoted: boolean) => Promise<void>;
  onChanged: () => Promise<unknown>;
  loadingKey: string | null;
  actionError: ActionError;
}) => {
  const { formatNumber, t } = useI18n();
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Layers3 className="size-4 shrink-0 text-muted-foreground" />
            <p className="break-words text-sm font-semibold">
              {getGroupDisplayTitle(group) ?? t("content.group.defaultTitle")}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("content.group.originals", {
              count: group.cards.length,
              formattedCount: formatNumber(group.cards.length),
            })}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatNumber(group.cards.length)}
        </span>
      </div>
      <details className="mt-3 border-t pt-3">
        <summary className="cursor-pointer rounded-md text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {t("content.group.showOriginals")}
        </summary>
        <ul className="mt-2 divide-y">
          {group.cards.map((card) => (
            <li key={card.id} className="py-3 first:pt-1 last:pb-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <CardText card={card} />
                </div>
                <CardMenu
                  boardId={boardId}
                  card={card}
                  revision={revision}
                  canManageActionItems={canManageActionItems}
                  disabled={loadingKey !== null}
                  onChanged={onChanged}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {t("content.vote.votesLabel", {
                    count: card.voteCount,
                    formattedCount: formatNumber(card.voteCount),
                  })}
                </span>
                {card.viewerHasVoted ? (
                  <span>{t("content.vote.yourVote")}</span>
                ) : null}
              </div>
              {card.viewerHasVoted && card.id !== group.primaryCardId ? (
                <VoteButton
                  cardId={card.id}
                  voteLabel={t("content.vote.voteForOriginalCard", {
                    text: card.text,
                  })}
                  removeVoteLabel={t(
                    "content.vote.removeVoteFromOriginalCard",
                    { text: card.text },
                  )}
                  voteCount={card.voteCount}
                  viewerHasVoted
                  canVote={canVote}
                  voteLimit={voteLimit}
                  remainingVotes={remainingVotes}
                  onToggleVote={onToggleVote}
                  loadingKey={loadingKey}
                  actionError={actionError}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
};

const ActionItemsColumn = ({
  boardId,
  board,
  onChanged,
  disabled,
}: {
  boardId: string;
  board: BoardSnapshot;
  onChanged: () => Promise<unknown>;
  disabled: boolean;
}) => {
  const { formatNumber, t } = useI18n();
  return (
    <li className="h-full min-h-0 w-[calc(100vw-3rem-env(safe-area-inset-left)-env(safe-area-inset-right))] max-w-[23.75rem] shrink-0 snap-start sm:w-[21rem] lg:w-[min(23.75rem,calc((100vw-6rem)/3))]">
      <section
        role="region"
        aria-labelledby="action-items-heading"
        className="flex h-full min-h-[28rem] flex-col overflow-hidden rounded-[10px] border border-primary/20 bg-card"
      >
        <header className="border-b px-3 py-3">
          <div className="flex min-w-0 items-start gap-2">
            <span
              className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-start gap-2">
                <h3
                  id="action-items-heading"
                  className="min-w-0 flex-1 text-[15px] leading-5 font-semibold"
                >
                  {t("content.action.heading")}
                </h3>
                <span
                  className="inline-flex min-w-6 justify-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
                  aria-label={t("content.action.count", {
                    count: board.actionItems.length,
                    formattedCount: formatNumber(board.actionItems.length),
                  })}
                >
                  {formatNumber(board.actionItems.length)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("content.action.description")}
              </p>
            </div>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          {board.capabilities.canManageActionItems ? (
            <ActionItemComposer
              boardId={boardId}
              disabled={disabled}
              onChanged={onChanged}
              className="rounded-none border-0 border-b bg-transparent p-0 pb-3"
            />
          ) : null}
          <ol className="flex min-h-20 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
            {board.actionItems.length === 0 ? (
              <li className="flex min-h-20 items-center justify-center px-4 py-6 text-center text-sm text-muted-foreground">
                {t("content.action.empty")}
              </li>
            ) : (
              board.actionItems.map((item, index) => (
                <SortableActionItem
                  key={item.id}
                  boardId={boardId}
                  board={board}
                  item={item}
                  index={index}
                  disabled={disabled}
                  onChanged={onChanged}
                />
              ))
            )}
          </ol>
        </div>
      </section>
    </li>
  );
};

const SortableActionItem = ({
  boardId,
  board,
  item,
  index,
  disabled,
  onChanged,
}: {
  boardId: string;
  board: BoardSnapshot;
  item: ActionItemView;
  index: number;
  disabled: boolean;
  onChanged: () => Promise<unknown>;
}) => {
  const { formatDate, formatRelativeTime, t } = useI18n();
  const canManage = board.capabilities.canManageActionItems;
  const { ref, targetRef, handleRef, isDragSource, isDropTarget } = useSortable(
    {
      id: boardDndIds.action(item.id),
      index,
      group: ACTION_GROUP,
      type: DND_TYPES.action,
      accept: DND_TYPES.action,
      data: { label: actionLabel(item, t) },
      disabled: {
        draggable: disabled || !canManage,
        droppable: disabled || !canManage,
      },
    },
  );

  return (
    <li
      ref={canManage ? ref : targetRef}
      aria-label={actionLabel(item, t)}
      className={cn(
        "rounded-lg border bg-card p-3 transition-[border-color,background-color,opacity] hover:border-border/80 hover:bg-secondary/25",
        isDragSource && "opacity-30",
        isDropTarget && "border-primary/40 ring-2 ring-primary/15",
      )}
    >
      <div className="flex items-start gap-3">
        {canManage ? (
          <ActionItemCompletionControl
            boardId={boardId}
            item={item}
            disabled={disabled}
            onChanged={onChanged}
          />
        ) : (
          <span
            role="img"
            aria-label={
              item.completed
                ? t("content.action.completedStatus")
                : t("content.action.activeStatus")
            }
            className={cn(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border text-xs",
              item.completed
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-border text-transparent",
            )}
          >
            <span aria-hidden="true">✓</span>
          </span>
        )}
        <div className="min-w-0 space-y-2">
          <p
            className={cn(
              "whitespace-pre-wrap break-words text-sm leading-6",
              item.completed && "text-muted-foreground line-through",
            )}
          >
            {item.text}
          </p>
          {item.assignee ? (
            <p className="text-xs text-muted-foreground">
              {t("content.action.assigneeLabel", {
                assignee: item.assignee,
              })}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1 border-t pt-2">
        <time
          dateTime={item.createdAt}
          title={formatDate(item.createdAt, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
          suppressHydrationWarning
          className="mr-auto min-w-0 truncate text-[11px] text-muted-foreground"
        >
          {(() => {
            const relative = relativeDateParts(item.createdAt);
            return formatRelativeTime(relative.value, relative.unit);
          })()}
        </time>
        {canManage ? (
          <DragHandle
            ref={handleRef}
            label={t("content.action.moveLabel", {
              text: item.text.slice(0, 80),
            })}
            disabled={disabled}
          />
        ) : null}
        {canManage ? (
          <ActionItemMenu
            boardId={boardId}
            item={item}
            revision={board.revision}
            disabled={disabled}
            onChanged={onChanged}
          />
        ) : null}
      </div>
    </li>
  );
};
