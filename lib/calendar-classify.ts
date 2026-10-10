/**
 * Which calendar entries are Travel, which are Events, and which are only meetings (issue 0021; Juan, 10 Oct 2026).
 * People keep trips and conferences as entries in one calendar, usually their main one, so each entry is sorted by
 * what it is, not by which calendar holds it. Pure; nothing is read here.
 *
 *   1. A relabel someone clicked on the Calendar page, remembered for that entry.
 *   2. "[travel]" or "[event]" in the entry's title.
 *   3. The entry's Google colour, when its owner picked one for Travel or for Events in Preferences.
 *   4. Event: conference, summit or talk wording, or a Luma, Eventbrite or registration link.
 *      Travel: an entry over two or more days with a place, that is not an Event; the place is the destination.
 *      Meeting: everything else. A meeting stays a touchpoint on the LP (docs/25 §13), not a mark here.
 *
 * A link is only seen in an entry's description when the mailguard key holds calendar.read.details; its place
 * often carries the link too.
 */

export type CalendarLabel = 'travel' | 'events' | 'meeting';
export const CALENDAR_LABELS: CalendarLabel[] = ['travel', 'events', 'meeting'];

export interface ClassifiableEntry {
  title: string;
  description?: string | null;
  location?: string | null;
  colorId?: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
}

/** A person's colour picks: one Google event colour for Travel and one for Events, or none. */
export interface ColourPicks { travel: string | null; events: string | null }
export const NO_COLOURS: ColourPicks = { travel: null, events: null };

/** Google Calendar's event colours, by the colorId its API returns. */
export const GOOGLE_COLOURS: Array<{ id: string; name: string; hex: string }> = [
  { id: '1', name: 'Lavender', hex: '#7986cb' }, { id: '2', name: 'Sage', hex: '#33b679' },
  { id: '3', name: 'Grape', hex: '#8e24aa' }, { id: '4', name: 'Flamingo', hex: '#e67c73' },
  { id: '5', name: 'Banana', hex: '#f6bf26' }, { id: '6', name: 'Tangerine', hex: '#f4511e' },
  { id: '7', name: 'Peacock', hex: '#039be5' }, { id: '8', name: 'Graphite', hex: '#616161' },
  { id: '9', name: 'Blueberry', hex: '#3f51b5' }, { id: '10', name: 'Basil', hex: '#0b8043' },
  { id: '11', name: 'Tomato', hex: '#d50000' },
];

const TAG = /\[(travel|trip|events?)\]/i;
/** GUESS: the words that make an entry an event. Juan named conference, summit and talk; the rest are their kin. */
const EVENT_WORDS = /\b(conference|summit|talks?|keynote|symposium|expo|meetup|hackathon|panel|workshop|festival)\b/i;
/** GUESS: an event's link: Luma, Eventbrite, or a link whose address says register or registration. */
const EVENT_LINK = /https?:\/\/[^\s"'<>]*(?:lu\.ma|luma\.com|eventbrite\.|regist)/i;

const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
/** An all-day entry ends at the next midnight, so its last day is the one before. */
export const lastDay = (e: Pick<ClassifiableEntry, 'start' | 'end' | 'allDay'>) =>
  new Date(Math.max(e.start.getTime(), e.end.getTime() - (e.allDay ? 1 : 0)));
export const spansDays = (e: Pick<ClassifiableEntry, 'start' | 'end' | 'allDay'>) => day(lastDay(e)) > day(e.start);

export interface Sorted { label: CalendarLabel; by: 'relabel' | 'tag' | 'colour' | 'wording' | 'link' | 'days and place' | 'rest' }

export function classify(e: ClassifiableEntry, colours: ColourPicks = NO_COLOURS, relabel: CalendarLabel | null = null): Sorted {
  if (relabel) return { label: relabel, by: 'relabel' };
  const tag = TAG.exec(e.title)?.[1]?.toLowerCase();
  if (tag) return { label: tag.startsWith('event') ? 'events' : 'travel', by: 'tag' };
  if (e.colorId && colours.travel === e.colorId) return { label: 'travel', by: 'colour' };
  if (e.colorId && colours.events === e.colorId) return { label: 'events', by: 'colour' };
  if (EVENT_WORDS.test(e.title)) return { label: 'events', by: 'wording' };
  if (EVENT_LINK.test(e.location ?? '') || EVENT_LINK.test(e.description ?? '')) return { label: 'events', by: 'link' };
  if (spansDays(e) && (e.location ?? '').trim()) return { label: 'travel', by: 'days and place' };
  return { label: 'meeting', by: 'rest' };
}

/** What the Calendar page says about why an entry is where it is. */
export const SORTED_BY: Record<Sorted['by'], string> = {
  relabel: 'relabelled here', tag: 'tagged in its title', colour: 'by its colour', wording: 'by its wording',
  link: 'by its event link', 'days and place': 'several days with a place', rest: 'a meeting',
};
