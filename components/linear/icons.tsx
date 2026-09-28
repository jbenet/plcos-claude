import type { Person, ProjectStatusType, StateType } from '@/modules/linear';
import { PRIORITY_LABEL } from '@/modules/linear';

/**
 * Linear's iconography, redrawn: the same shapes a Linear user reads without thinking (a dashed
 * circle is backlog, a half-filled one is in progress, three bars are high priority), drawn here
 * from our own palette. No Linear asset is used.
 */

const STATE_WORD: Record<StateType, string> = {
  triage: 'Triage', backlog: 'Backlog', unstarted: 'Todo', started: 'In progress', completed: 'Done', canceled: 'Canceled', duplicate: 'Duplicate', unknown: 'Unknown state',
};

/** The status circle, by workflow state type. A started state named like "review" draws three quarters, as Linear's does. */
export function StatusIcon({ type, name, size = 14 }: { type: StateType | ProjectStatusType | 'paused'; name?: string; size?: number }) {
  const label = name ?? (type in STATE_WORD ? STATE_WORD[type as StateType] : type);
  const common = { width: size, height: size, viewBox: '0 0 14 14', role: 'img', 'aria-label': label, focusable: false } as const;
  switch (type) {
    case 'backlog':
      return <svg {...common}><title>{label}</title><circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="1.4 1.66" /></svg>;
    case 'unstarted': case 'planned':
      return <svg {...common}><title>{label}</title><circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--muted)" strokeWidth="1.5" /></svg>;
    case 'started': {
      const review = name ? /review|qa|verify/i.test(name) : false;
      const c = review ? 'var(--green)' : 'var(--amber)';
      // A pie from 12 o'clock: half for in progress, three quarters for review.
      const d = review ? 'M7 7 L7 3.4 A3.6 3.6 0 1 1 3.4 7 Z' : 'M7 7 L7 3.4 A3.6 3.6 0 0 1 7 10.6 Z';
      return <svg {...common}><title>{label}</title><circle cx="7" cy="7" r="5.6" fill="none" stroke={c} strokeWidth="1.5" /><path d={d} fill={c} /></svg>;
    }
    case 'paused':
      return <svg {...common}><title>{label}</title><circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--amber)" strokeWidth="1.5" /><rect x="5" y="4.6" width="1.3" height="4.8" rx=".4" fill="var(--amber)" /><rect x="7.7" y="4.6" width="1.3" height="4.8" rx=".4" fill="var(--amber)" /></svg>;
    case 'completed':
      return <svg {...common}><title>{label}</title><circle cx="7" cy="7" r="6.3" fill="var(--purple)" /><path d="M4.4 7.2 L6.2 9 L9.7 5.3" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'canceled': case 'duplicate':
      return <svg {...common}><title>{label}</title><circle cx="7" cy="7" r="6.3" fill="var(--muted)" opacity=".75" /><path d="M4.9 4.9 L9.1 9.1 M9.1 4.9 L4.9 9.1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" /></svg>;
    case 'triage':
      return <svg {...common}><title>{label}</title><circle cx="7" cy="7" r="6.3" fill="var(--clay)" /><path d="M4 5.6 H9.4 L8 4.2 M10 8.4 H4.6 L6 9.8" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    default:
      return <svg {...common}><title>{label}</title><circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--muted)" strokeWidth="1.2" strokeDasharray="0.6 2" /></svg>;
  }
}

/** Priority: three dashes for none, an exclamation box for urgent, one to three bars for low to high. */
export function PriorityIcon({ priority, size = 14 }: { priority: number; size?: number }) {
  const p = priority >= 0 && priority <= 4 ? priority : 0;
  const label = PRIORITY_LABEL[p];
  const common = { width: size, height: size, viewBox: '0 0 14 14', role: 'img', 'aria-label': label, focusable: false } as const;
  if (p === 0) {
    return <svg {...common}><title>{label}</title>{[1.5, 5.75, 10].map((x) => <rect key={x} x={x} y="6.4" width="2.6" height="1.3" rx=".5" fill="var(--muted)" opacity=".75" />)}</svg>;
  }
  if (p === 1) {
    return <svg {...common}><title>{label}</title><rect x=".8" y=".8" width="12.4" height="12.4" rx="3" fill="var(--clay)" /><rect x="6.2" y="3.3" width="1.6" height="4.9" rx=".7" fill="#fff" /><rect x="6.2" y="9.3" width="1.6" height="1.6" rx=".7" fill="#fff" /></svg>;
  }
  const filled = 5 - p; // high 3, medium 2, low 1
  return (
    <svg {...common}>
      <title>{label}</title>
      {[[1.5, 8, 4.5], [5.75, 5, 7.5], [10, 2, 10.5]].map(([x, y, h], i) => (
        <rect key={i} x={x} y={y} width="2.6" height={h} rx=".7" fill={i < filled ? 'var(--label)' : 'var(--line)'} />
      ))}
    </svg>
  );
}

/** A soft, stable colour per person, so the same face is the same colour everywhere. */
function hue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function Avatar({ person, size = 18 }: { person: Person | null; size?: number }) {
  if (!person) {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" role="img" aria-label="No assignee" focusable={false}>
        <title>No assignee</title>
        <circle cx="9" cy="9" r="8" fill="none" stroke="var(--muted)" strokeWidth="1.2" strokeDasharray="2 1.6" />
        <circle cx="9" cy="7.2" r="2.2" fill="none" stroke="var(--muted)" strokeWidth="1.1" />
        <path d="M5.4 13.2 C6 11 7.4 10.4 9 10.4 C10.6 10.4 12 11 12.6 13.2" fill="none" stroke="var(--muted)" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    );
  }
  const initials = person.initials.slice(0, 2);
  return (
    <span
      role="img"
      aria-label={person.name}
      title={person.ours ? person.name : `${person.name} · not matched to our team`}
      style={{
        width: size, height: size, borderRadius: '50%', flex: 'none', display: 'inline-grid', placeItems: 'center',
        background: `hsl(${hue(person.name)} 28% 44%)`, color: '#fff', fontFamily: 'var(--sans)', fontWeight: 600,
        fontSize: Math.round(size * (initials.length > 1 ? 0.42 : 0.5)), letterSpacing: '-.02em', lineHeight: 1,
      }}
    >
      {initials}
    </span>
  );
}

/** Linear's project glyph, redrawn: a small box in the project's colour. */
export function ProjectIcon({ color, size = 12 }: { color: string | null; size?: number }) {
  const c = color ?? 'var(--muted)';
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden focusable={false}>
      <path d="M6 .9 L10.6 3.4 V8.6 L6 11.1 L1.4 8.6 V3.4 Z" fill={c} fillOpacity=".18" stroke={c} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M1.6 3.5 L6 6 L10.4 3.5 M6 6 V10.9" fill="none" stroke={c} strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

export function CalendarIcon({ overdue = false, size = 12 }: { overdue?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden focusable={false}>
      <rect x="1.2" y="2.2" width="9.6" height="8.6" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M1.2 4.8 H10.8 M3.8 1 V3 M8.2 1 V3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      {overdue && <path d="M6 6 V7.9 M6 9.3 V9.35" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
    </svg>
  );
}

/** Done/total as a small ring, as Linear draws project progress. */
export function ProgressRing({ done, total, color, size = 14 }: { done: number; total: number; color?: string | null; size?: number }) {
  const f = total > 0 ? done / total : 0;
  const r = 5.2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden focusable={false}>
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--line)" strokeWidth="2" />
      {f > 0 && <circle cx="7" cy="7" r={r} fill="none" stroke={color ?? 'var(--purple)'} strokeWidth="2" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 7 7)" strokeLinecap={f < 1 ? 'round' : 'butt'} />}
    </svg>
  );
}
