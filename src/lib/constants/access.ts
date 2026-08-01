// Modern browsers cap persistent cookies at roughly 400 days. Boards expire
// sooner so an intact anonymous credential never expires before its board.
export const ANONYMOUS_CREDENTIAL_LIFETIME_DAYS = 400;
export const MAX_BOARD_RETENTION_DAYS = 365;

// Hard lifetime caps keep a single board bounded even when an owner repeatedly
// creates/revokes invitations or participants leave and rejoin.
export const MAX_BOARD_PARTICIPANT_INVITATION_RECORDS = 500;
export const MAX_BOARD_PARTICIPANT_MEMBERSHIP_RECORDS = 500;
export const MAX_PARTICIPANT_INVITATION_USES = 100;
export const MAX_BOARD_OWNER_HISTORY_RECORDS = 20;
export const MAX_ACTIVE_OWNED_BOARDS_PER_SESSION = 20;
export const MAX_BOARD_TOTAL_VOTE_RECORDS =
  (MAX_BOARD_PARTICIPANT_MEMBERSHIP_RECORDS
    + MAX_BOARD_OWNER_HISTORY_RECORDS) * 6;

// Dynamic boards allow up to ten columns with twenty votes per identity in each
// column. Their export path therefore uses a wider bound than the legacy
// snapshot path above.
export const MAX_TARGET_BOARD_TOTAL_VOTE_RECORDS =
  (MAX_BOARD_PARTICIPANT_MEMBERSHIP_RECORDS
    + MAX_BOARD_OWNER_HISTORY_RECORDS) * 10 * 20;
