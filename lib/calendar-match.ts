/** What a calendar touchpoint matched only by name says of itself (lib/calendar-sync.ts), so it can be told apart and undone. */
export const MATCHED_BY_NAME = 'Matched by name: the calendar entry names this LP or their firm, but no guest on it is on record for them. Lower confidence.';
/** A touchpoint matched only by the name of someone currently at the LP firm (Juan, 13 Oct 2026: "person at firm"). */
export const MATCHED_BY_AFFILIATE = 'Matched by name: the calendar entry names someone at this firm, but no guest on it is on record for them. Lower confidence.';
/** Either kind of name match: shown as lower confidence, with "Not this LP" to undo it. */
export const isNameMatch = (summary: string | null | undefined) => summary === MATCHED_BY_NAME || summary === MATCHED_BY_AFFILIATE;
