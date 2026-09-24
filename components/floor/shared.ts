import type { FloorItem, Temp } from '@/lib/floor-client';
import { RUNG_LABEL, rungIndex, STATUSES, STATUS_LABEL, type PursuitStatus } from '@/modules/strategy/client';

/**
 * One visual vocabulary, shared by all five views.
 *
 * The views disagree about layout on purpose. They must not disagree about what a colour
 * or a size means, or switching tabs teaches you nothing — it just makes you relearn.
 *
 * - **Size** is money at stake, on a square-root scale so a $18M block is wider than a
 *   $2M one without being nine times wider. An item nobody has a number for is drawn at
 *   the minimum width, never at a guess.
 * - **Fill strength** is recency: solid means something was recorded this week, faint
 *   means nothing for six.
 * - **Hue** is reserved for exceptions — blocked, urgent, cash in the bank — so that a
 *   floor with nothing wrong on it is a floor with no colour on it.
 * - **Place** is the status, wherever a view has stations, columns or bars. The ladder is
 *   the evidence under it, in the tooltip and the console, and ◇ marks a status the ladder
 *   does not back yet. Only the views about evidence over time (the flow, the plant) are
 *   laid out by rung, and they say so.
 * - Every one of those is also a word or a glyph on the mark, because colour is never the
 *   only signal.
 */

export const TEMP_ALPHA: Record<Temp, number> = {
  hot: 1, warm: 0.62, cool: 0.34, cold: 0.16, unmoved: 0.07, done: 0.85,
};

export type MarkState = 'blocked' | 'urgent' | 'cash' | 'plain';

export const STATE_GLYPH: Record<MarkState, string> = {
  blocked: '✕', urgent: '!', cash: '✓', plain: '',
};

export const STATE_LABEL: Record<MarkState, string> = {
  blocked: 'Blocked', urgent: 'Dated, soon', cash: 'Cash received', plain: 'Running',
};

/**
 * The status is where a view puts a mark; the ladder is the evidence under it (N62). When the
 * status claims more than the ladder shows, the mark carries this glyph and the words say
 * "Needs evidence". No hue: it is a gap in the records, not an alarm, and hue is spoken for.
 */
export const EVIDENCE_GLYPH = '◇';

/** Left to right, the order the pipeline reads in. Passed last. */
export function statusOrder(status: PursuitStatus): number {
  return STATUSES.findIndex((s) => s.id === status);
}

type Ladder = Pick<FloorItem, 'rung' | 'ladderRung' | 'pursuitId'>;

/** The rung the words should name: the ladder's, or with no pursuit, the close track's. */
export function shownRung(item: Ladder) {
  return item.pursuitId ? item.ladderRung : item.rung;
}

/** The close track is ahead of the ladder: a record on file that no STAGE ticket has confirmed. */
export function aheadOnRecord(item: Ladder) {
  return item.pursuitId !== null && rungIndex(item.rung) > rungIndex(item.ladderRung) ? item.rung : null;
}

/**
 * The ladder under the status, in the words the rest of the app uses: what the ladder has
 * confirmed, and what the close track records beyond it, which is on record and not yet on the
 * ladder (N57). With no pursuit there is no ladder, only the close track.
 */
export function ladderWords(item: Ladder): string {
  if (!item.pursuitId) return item.rung ? `${RUNG_LABEL[item.rung]}, from the close track` : 'Nothing on record';
  const confirmed = item.ladderRung ? `${RUNG_LABEL[item.ladderRung]} on the ladder` : 'Nothing on the ladder yet';
  const ahead = aheadOnRecord(item);
  return ahead ? `${confirmed}; ${RUNG_LABEL[ahead]} on the close track, not confirmed yet` : confirmed;
}

/** The same, in a cell's width: the rung that gates what can be done next. */
export function rungShort(item: Ladder): string {
  if (!item.rung) return 'Nothing yet';
  return !item.pursuitId || aheadOnRecord(item) ? `${RUNG_LABEL[item.rung]} (close track)` : RUNG_LABEL[item.rung];
}

/** What the status claims that the ladder has not confirmed, or null when nothing is missing. */
export function claimWords(item: Pick<FloorItem, 'status' | 'needsEvidence'>): string | null {
  return item.needsEvidence
    ? `${STATUS_LABEL[item.status]} claims ${RUNG_LABEL[item.needsEvidence]}; the ladder hasn’t confirmed it.`
    : null;
}

/** The status, with the ladder under it: one line for a tooltip or a small row. */
export function standingWords(item: Pick<FloorItem, 'status' | 'needsEvidence'> & Ladder): string {
  return `${STATUS_LABEL[item.status]}${item.needsEvidence ? ' · needs evidence' : ''} · ${ladderWords(item)}`;
}

/** Where an item opens: its LP page when a pursuit is behind it, their own page when not. */
export function itemHref(item: Pick<FloorItem, 'pursuitId' | 'entityId'>): string {
  return item.pursuitId ? `/targets/${item.pursuitId}` : `/orgs/${item.entityId}`;
}

export function stateOf(item: FloorItem): MarkState {
  if (item.blocked || item.restricted || item.conflict) return 'blocked';
  if (item.urgent) return 'urgent';
  if (item.cashReceived) return 'cash';
  return 'plain';
}

/** Square-root width scale with a floor, so an unsized item is visibly unsized. */
export function widthScale(items: FloorItem[], min: number, max: number) {
  const top = Math.max(1, ...items.map((i) => i.amount ?? 0));
  return (amount: number | null) => (amount === null || amount === 0
    ? min
    : min + Math.sqrt(amount / top) * (max - min));
}

export function shortName(name: string, max = 18): string {
  return name.length <= max ? name : `${name.slice(0, max - 1)}…`;
}

export function compactUsd(amount: number | null): string {
  if (amount === null) return 'no number';
  return amount >= 1_000_000 ? `$${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`
    : `$${Math.round(amount / 1000)}k`;
}

export function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}
