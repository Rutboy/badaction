import { ApiError } from "../errors/api-error-base.ts";

export const MAX_BOARD_STREAMS_PER_VISITOR = 3;
const STREAM_LIMIT_RETRY_AFTER_SECONDS = 30;

export type BoardStreamLease = {
  release: () => void;
};

export class BoardStreamLimit {
  private readonly counts = new Map<string, number>();

  acquire(boardId: string, visitorIdentity: string): BoardStreamLease {
    const key = `${boardId}:${visitorIdentity}`;
    const count = this.counts.get(key) ?? 0;
    if (count >= MAX_BOARD_STREAMS_PER_VISITOR) {
      throw new ApiError(
        429,
        "RATE_LIMIT_EXCEEDED",
        "Too many concurrent connections to this board.",
        { retryAfterSeconds: STREAM_LIMIT_RETRY_AFTER_SECONDS },
      );
    }

    this.counts.set(key, count + 1);
    let released = false;
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        const current = this.counts.get(key) ?? 0;
        if (current <= 1) {
          this.counts.delete(key);
        } else {
          this.counts.set(key, current - 1);
        }
      },
    };
  }
}

const globalForBoardStreams = globalThis as typeof globalThis & {
  boardStreamLimit?: BoardStreamLimit;
};

export const boardStreamLimit = globalForBoardStreams.boardStreamLimit
  ?? new BoardStreamLimit();

globalForBoardStreams.boardStreamLimit = boardStreamLimit;
