import type { GlyphName } from '@/components/ui/Glyph';

/**
 * The calendar's lanes, and how each looks (issue 0020): one icon and one colour per kind of dated
 * thing, the same on the chart, its key and the list — and the timeline's icon where the thing is
 * the same (a meeting is the calendar mark everywhere). Client-safe: the list filters in the
 * browser. Colour is never the only signal: every lane also has its icon and its name.
 */
export type Lane =
  | 'close' | 'spv' | 'outreach' | 'meetings' | 'deadlines' | 'sprint' | 'grants' | 'travel' | 'events';

export const LANE_LABEL: Record<Lane, string> = {
  sprint: 'Sprints & dead weeks',
  close: 'Close',
  spv: 'SPV seats',
  outreach: 'Asks',
  meetings: 'Meetings',
  deadlines: 'Expiries & due dates',
  grants: 'Grants rail',
  travel: 'Travel',
  events: 'Events',
};

export const LANE_MEANS: Record<Lane, string> = {
  sprint: 'Periods from the sprint calendar, including the weeks that are structurally dead.',
  close: 'Close targets and the conditions that gate them.',
  spv: 'One bar per seat, invite through wire. An open seat runs to today.',
  outreach: 'Asks with a date on them. An ask nobody scheduled has no mark.',
  meetings: 'Scheduled and held. A held meeting is a fact; a scheduled one is an intention.',
  deadlines: 'Things that expire: tickets, accreditation letters, answers, diligence questions.',
  grants: 'Funder invitations. Outreach is blocked until one exists, so the date is the gate.',
  travel: 'Where the team is going, from the calendars each person added in Preferences → Calendars.',
  events: 'Conferences and gatherings the team is attending, from the calendars each person added in Preferences → Calendars.',
};

export interface LaneLook { label: string; means: string; glyph: GlyphName }

const GLYPH: Record<Lane, GlyphName> = {
  meetings: 'calendar', outreach: 'chat', close: 'coin', spv: 'folder', deadlines: 'ticket', grants: 'note', sprint: 'status', travel: 'arrow', events: 'calendar-next',
};

/** Keyed by lane, in the order the chips and the chart's key list them. */
export const LANE_LOOK: Record<Lane, LaneLook> = Object.fromEntries(
  (['meetings', 'outreach', 'close', 'spv', 'deadlines', 'grants', 'travel', 'events', 'sprint'] as Lane[])
    .map((l) => [l, { label: LANE_LABEL[l], means: LANE_MEANS[l], glyph: GLYPH[l] }]),
) as Record<Lane, LaneLook>;

/** One dated thing, as the list and the stats read it (dates as ISO strings, for the browser). */
export interface DatedRow {
  id: string;
  lane: Lane;
  label: string;
  team?: string[];
  lp?: string | null;
  /** Printed under the label only when it says more than the standing does. */
  detail: string | null;
  from: string;
  /** The end of a span, when it ends on another day. */
  to: string | null;
  vehicle: string | null;
  standing: 'pressing' | 'ahead' | 'done';
  href: string | null;
  /** A Travel or Events entry read from the team's calendars: why it is in its lane, and the key to relabel it. */
  entry?: { key: string; label: 'travel' | 'events' | 'meeting'; by: string };
}

/**
 * Presentation order only: no domain state changes when a user reverses the list (issue 0072).
 * By LP or by our team, a row with neither recorded goes last in either direction; ties fall back
 * to newest first.
 */
export function orderDatedRows(rows: DatedRow[], sort: string, ascending: boolean): DatedRow[] {
  const key = (r: DatedRow) => (sort === 'lp' ? r.lp ?? '' : sort === 'team' ? (r.team ?? []).join(', ') : r.from);
  return [...rows].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (sort !== 'date' && !ka !== !kb) return ka ? -1 : 1;
    return (ascending ? 1 : -1) * ka.localeCompare(kb) || b.from.localeCompare(a.from) || a.id.localeCompare(b.id);
  });
}
