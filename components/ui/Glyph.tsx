/**
 * Small line icons for what happened (N56): a meeting, an email each way, a deck view, questions
 * asked. Drawn inline, 16 px, in the text colour. An icon is never the only signal: every row that
 * shows one also says in words what it is, and the icon's title repeats it.
 */

export type GlyphName =
  | 'calendar' | 'calendar-next' | 'phone' | 'mail' | 'mail-in' | 'mail-out' | 'chat' | 'link'
  | 'ticket' | 'search' | 'note' | 'mic' | 'eye' | 'question' | 'folder' | 'coin' | 'pen' | 'stop'
  | 'chart' | 'person' | 'list' | 'update' | 'status' | 'rung' | 'check';

const PATHS: Record<GlyphName, React.ReactNode> = {
  calendar: <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></>,
  'calendar-next': <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3M7 8.5l2 1.5-2 1.5" /></>,
  phone: <path d="M5 2.5h2l1 3-1.5 1a7 7 0 0 0 3 3l1-1.5 3 1v2a1.5 1.5 0 0 1-1.5 1.5A10.5 10.5 0 0 1 3.5 4 1.5 1.5 0 0 1 5 2.5z" />,
  mail: <><rect x="2" y="4" width="12" height="9" rx="1.5" /><path d="M2.5 5l5.5 4 5.5-4" /></>,
  'mail-in': <><rect x="1.5" y="5" width="9.5" height="7.5" rx="1.2" /><path d="M2 6l4.25 3 4.25-3M14.5 1.5l-3 3M11.5 2v2.5H14" /></>,
  'mail-out': <><rect x="1.5" y="5" width="9.5" height="7.5" rx="1.2" /><path d="M2 6l4.25 3 4.25-3M11.5 4.5l3-3M12 1.5h2.5V4" /></>,
  chat: <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />,
  link: <path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1" />,
  ticket: <path d="M2.5 5.5v-2h11v2a1.5 1.5 0 0 0 0 3v2h-11v-2a1.5 1.5 0 0 0 0-3z" />,
  search: <><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /></>,
  note: <path d="M4 2.5h5.5l2.5 2.5v8.5H4zM6 7h4M6 9.5h4" />,
  mic: <><rect x="6" y="2" width="4" height="7" rx="2" /><path d="M4 7.5a4 4 0 0 0 8 0M8 11.5v2.5" /></>,
  eye: <><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>,
  question: <><circle cx="8" cy="8" r="6" /><path d="M6.3 6.3a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.8.6-.8 1.1v.4" /><circle cx="8" cy="11.3" r=".6" fill="currentColor" /></>,
  folder: <path d="M2 4.5h4l1.5 1.5H14v6.5H2z" />,
  coin: <><circle cx="8" cy="8" r="6" /><path d="M9.8 5.8c-.4-.5-1.1-.8-1.8-.8-1.1 0-1.9.6-1.9 1.4 0 1.9 3.8 1 3.8 3 0 .8-.8 1.4-1.9 1.4-.8 0-1.5-.3-1.9-.9M8 4v1M8 11v1" /></>,
  pen: <path d="M3 13l1-3.5 6.5-6.5 2.5 2.5-6.5 6.5zM9 4.5l2.5 2.5" />,
  stop: <><circle cx="8" cy="8" r="6" /><path d="M3.8 12.2l8.4-8.4" /></>,
  chart: <path d="M2.5 13.5h11M4 11l3-3.5 2.5 2 3.5-5" />,
  person: <><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5a5 5 0 0 1 10 0" /></>,
  // N61: an update written here (a pencil over a written line), a status set, a rung recorded.
  update: <><path d="M2 13.5c1.3-1 2.3-1 3.3 0s2.2 1 3.4 0" /><path d="M8 9.8l.5-2.1 4.4-4.4 1.6 1.6-4.4 4.4z" /></>,
  status: <><path d="M3.5 14V2.5" /><path d="M3.5 3h8.5l-2 2.8 2 2.7H3.5" /></>,
  rung: <path d="M5 2v12M11 2v12M5 5h6M5 8h6M5 11h6" />,
  check: <path d="M3.5 8.5l3 3 6-6.5" />,
  list: <><path d="M5.5 4.5h8M5.5 8h8M5.5 11.5h8" /><circle cx="3" cy="4.5" r=".6" fill="currentColor" /><circle cx="3" cy="8" r=".6" fill="currentColor" /><circle cx="3" cy="11.5" r=".6" fill="currentColor" /></>,
};

export function Glyph({ name, title, tone }: { name: GlyphName; title: string; tone?: 'signal' | 'good' | 'stop' | 'look' }) {
  return (
    <span className={`glyph${tone ? ` g-${tone}` : ''}`} title={title}>
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={title}>
        {PATHS[name]}
      </svg>
    </span>
  );
}
