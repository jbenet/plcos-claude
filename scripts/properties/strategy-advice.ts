/** Invented numbers only (issue 0097): recommendations follow the records, and utility ranks moves. */
import { gapAdvice, pipelineAdvice, type PipelineFacts, type Sentence } from '../../modules/strategy/advice';
import { presenceFor, utilityOf } from '../../modules/strategy/move-utility';
import { validateMoves } from '../../modules/strategy/moves';
import type { Check } from './harness';

const text = (s: Sentence[]) => s.map(x => x.map(seg => typeof seg === 'string' ? seg : seg.text).join('')).join(' ');
const money = (x: number) => `$${Math.round(x / 1000)}K`;

export function strategyAdviceProperties(check: Check) {
  const base: PipelineFacts = {
    counts: { new: 0, sourcing: 400, selected: 12, connecting: 120, discussing: 30, committed: 5 },
    softCommitted: { lps: 4, amount: 2_000_000 }, gap: null, meanSoft: null,
    discussingKey: [{ text: 'Invented LP A', href: '/a' }, { text: 'Invented LP B', href: '/b' }],
    connectingWithRoute: 45, introBatch: 20,
    links: { discussing: '/d', connecting: '/c', selection: '/s' }, money,
  };
  const busy = text(pipelineAdvice(base));
  check('0097 pipeline advice names the nearest work with the recorded counts',
    busy.includes('harden the $2000K soft held by 4 Committed LPs') && busy.includes('30 in Discussing') && busy.includes('Invented LP A and Invented LP B')
      && busy.includes('20 of the 120 in Connecting') && pipelineAdvice(base).length <= 2,
    busy);
  const noRoutes = text(pipelineAdvice({ ...base, connectingWithRoute: 0 }));
  check('0097 pipeline advice never proposes introductions without a recorded route', noRoutes.includes('find routes into the 120 in Connecting') && !noRoutes.includes('introductions'), noRoutes);
  const empty = text(pipelineAdvice({ ...base, counts: { new: 0, sourcing: 0, selected: 0, connecting: 0, discussing: 0, committed: 0 }, softCommitted: { lps: 0, amount: 0 } }));
  check('0097 an empty pipeline gets a starting step, not a follow-up', empty.startsWith('Nothing is in play yet'), empty);
  const target = text(pipelineAdvice({ ...base, counts: { ...base.counts, connecting: 0, discussing: 0 }, softCommitted: { lps: 0, amount: 0 }, discussingKey: [], gap: 3_500_000, meanSoft: 250_000 }));
  check('0097 the gap sentence says its check size is a GUESS and compares with what is in play',
    target.includes('needs about 14 more commitments') && target.includes('(GUESS)') && target.includes('than the 12 LPs'), target);

  const gaps = (near: number, total: number) => gapAdvice({ active: 1000, near: 60, gaps: [
    { id: 'research', total, near, href: '/r' }, { id: 'owner', total: 3, near: 0, href: '/o' }] });
  const nearGap = text(gaps(25, 700));
  check('0097 gap advice starts with the LPs nearest money, then says where the bulk sits',
    nearGap.startsWith('Nearest money first: research the 25') && nearGap.includes('700 without research sit mostly in New and Sourcing'), nearGap);
  const fine = text(gapAdvice({ active: 1000, near: 60, gaps: [{ id: 'research', total: 10, near: 0, href: '/r' }] }));
  check('0097 small gaps away from the pipeline are called fine', fine.startsWith('Coverage is fine'), fine);

  const rules = { presencePointValue: 10_000, presenceDefaults: { presence: 3, events: 2 } };
  const video = utilityOf(rules, { reach: 40, capital: 48_000, presence: presenceFor(rules, 'video').value });
  const close = utilityOf(rules, { reach: 5, capital: 72_000, presence: presenceFor(rules, 'close operations').value });
  const own = presenceFor(rules, 'video', { value: 1, basis: 'Invented estimate', label: 'GUESS' });
  check('0097 utility adds presence to capital, and a move’s own estimate beats its kind’s default',
    video.utility === 78_000 && close.utility === 72_000 && own.value === 1 && own.source === 'move' && presenceFor(rules, 'video').source === 'default', `video ${video.utility}, close ${close.utility}`);
  const estimate = (value: number) => ({ value, basis: 'Invented', label: 'GUESS' as const });
  const move = (presence?: { value: number; basis: string; label: 'GUESS' }) => ({ version: 1 as const, moves: [{ id: 'invented-presence', title: 'Invented', category: 'video', detail: 'Invented',
    evidence: [{ source: 'Invented', as_of: '2026-09-27', confidence: 'low', last_verified_by: 'Invented', supports: 'Invented' }],
    vehicles: [{ slug: 'invented', estimates: { reach: estimate(4), check: estimate(1000), baseline: estimate(.1), conversionLift: estimate(.1), checkLift: estimate(0),
      confidence: estimate(.5), teamHours: estimate(2), cashCost: estimate(0), effectDays: estimate(7), audience: 'Invented', dependencies: 'Invented', ...(presence ? { presence } : {}) } }] }] });
  const refused = (f: unknown) => { try { validateMoves(f); return false; } catch { return true; } };
  check('0097 a presence estimate is optional, but when given it is a GUESS from 0 to 5 with a basis',
    !refused(move()) && !refused(move(estimate(4))) && refused(move(estimate(6))) && refused(move({ value: 2, basis: '', label: 'GUESS' })), 'absent, 4 accepted; 6 and an empty basis refused');
}
