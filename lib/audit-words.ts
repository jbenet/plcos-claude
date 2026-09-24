import type { AuditRow } from '@/modules/platform';
import { RUNG_LABEL, type LadderRung } from '@/modules/strategy';

/**
 * The audit log in words (N62, issue 0007): "Juan set the status to Discussing, from Selected —
 * Omar Haddad · PLC Neurotech I" rather than "pursuit.status_set". What an entry names comes
 * from its own detail; an action this doesn't know is shown by its name, not guessed at.
 */
export function describeAudit(a: AuditRow): { what: string; about: string | null } {
  const d = a.detail as Record<string, unknown>;
  const who = a.actor ?? 'The system';
  const s = (k: string) => (typeof d[k] === 'string' && d[k] ? (d[k] as string) : null);
  const on = [s('entity'), s('vehicle')].filter(Boolean).join(' · ') || null;
  const rung = (r: string | null) => (r && r in RUNG_LABEL ? RUNG_LABEL[r as LadderRung] : r ?? 'a rung');
  switch (a.action) {
    case 'pursuit.status_set':
      return { what: `${who} set the status to ${s('to') ?? '?'}${s('from') && s('from') !== s('to') ? `, from ${s('from')}` : ''}`, about: on };
    case 'pursuit.update_added': return { what: `${who} wrote an update`, about: on };
    case 'pursuit.next_step_set': return { what: `${who} set the next step: “${s('nextStep') ?? ''}”`, about: on };
    case 'ladder.advanced': return { what: `${rung(s('rung'))} recorded on the ladder, approved by ${who}`, about: on };
    case 'ladder.climbed': {
      const rungs = Array.isArray(d['rungs']) ? (d['rungs'] as string[]).map((x) => x.split(':')[0]!) : [];
      return { what: `${rungs.map((r) => rung(r)).join(', ') || 'Rungs'} recorded on the ladder, approved by ${who}`, about: on };
    }
    case 'touchpoint.logged': {
      const ch = s('channel') ?? 'touchpoint';
      return { what: `${who} logged ${/^[aeiou]/.test(ch) ? 'an' : 'a'} ${ch}${d['scheduled'] ? ', still ahead' : ''}`, about: on };
    }
    case 'ticket.opened': return { what: `${who} opened a ${s('kind') ?? ''} ticket`, about: s('label') };
    case 'feedback.filed': return { what: `${who} filed feedback`, about: s('title') };
    case 'exposure.hardened': return { what: `${who} hardened a commitment`, about: on };
    case 'commitment.written': return { what: `${who} recorded a commitment`, about: on };
    case 'conflict.adjudicated': return { what: `${who} decided an overlap between two vehicles`, about: on };
    case 'ask.proposed': return { what: `${who} proposed an intro ask`, about: on };
    case 'ask.made': return { what: `${who} made an intro ask`, about: on };
    case 'send.sent': return { what: `${who} recorded a send`, about: on };
    case 'play.assigned': return { what: `${who} assigned a play`, about: on };
    default: return { what: `${who} · ${a.action.replace(/[._]/g, ' ')}`, about: on };
  }
}
