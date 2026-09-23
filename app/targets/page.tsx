import { Page } from '@/components/shell/Page';
import { PipelineTable, type PipelineRow } from '@/components/strategy/PipelineTable';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import {
  IMPLIED_LABEL, PASSED_BY_LABEL, RUNGS, RUNG_LABEL, STATUSES,
  impliedRung, listPursuits, rungIndex, type Pursuit, type PursuitStatus,
} from '@/modules/strategy';
import { READ_LABEL, touchpointSummaries, type TouchpointSummary } from '@/modules/meetings';
import { CLOSE_STATE_LABEL, closeStates } from '@/modules/pipeline';
import { blanketRestricted } from '@/modules/coordination';

export const dynamic = 'force-dynamic';

/**
 * The log has got ahead of the status: a meeting on record for an LP still at Selected or
 * earlier. Shown as a question — the status is a person's call, and it is never moved for them.
 */
function aheadOfStatus(p: Pursuit, s: TouchpointSummary): boolean {
  return (p.status === 'new' || p.status === 'sourcing' || p.status === 'selected') && s.meetingDates.length > 0;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export default async function Pipeline({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const [{ status: asked }, selection] = await Promise.all([searchParams, vehicleSelection()]);
  const current = selection.current;
  // All vehicles means the ones being raised: a vehicle kept for its history is shown when it
  // is the one selected, and counted, not mixed in.
  const history = new Set(selection.all.filter((v) => v.phase === 'historical').map((v) => v.id));
  const all = await listPursuits(current?.id ?? null);
  const pursuits = all.filter((p) => (current ? true : !history.has(p.vehicleId)));
  const onHistory = all.length - pursuits.length;

  const pairs = pursuits.map((p) => ({ entityId: p.entityId, vehicleId: p.vehicleId }));
  const [sums, closes, restricted] = await Promise.all([
    touchpointSummaries(pairs), closeStates(pairs), blanketRestricted([...new Set(pursuits.map((p) => p.entityId))]),
  ]);
  const sum = (p: Pursuit) => sums.get(`${p.entityId}:${p.vehicleId}`)!;

  // Furthest along first: by evidence, then meetings held, then what the source's word says
  // happened; then the most recently in touch, then the name. The table can re-sort by column.
  pursuits.sort(
    (a, b) =>
      rungIndex(b.rung) - rungIndex(a.rung) ||
      sum(b).meetingDates.length - sum(a).meetingDates.length ||
      rungIndex(impliedRung(b.implied)) - rungIndex(impliedRung(a.implied)) ||
      (sum(b).lastTouch?.getTime() ?? 0) - (sum(a).lastTouch?.getTime() ?? 0) ||
      a.entityName.localeCompare(b.entityName),
  );

  const rows: PipelineRow[] = pursuits.map((p) => {
    const s = sum(p);
    const c = closes.get(`${p.entityId}:${p.vehicleId}`);
    return {
      id: p.pursuitId,
      name: p.entityName,
      headline: p.headline,
      vehicle: p.vehicleName,
      owner: p.ownerSaid ?? p.ownerName,
      status: p.status,
      ended: p.status === 'passed'
        ? [p.passedBy ? PASSED_BY_LABEL[p.passedBy] : 'Passed', p.statusReason?.replace(/_/g, ' ')].filter(Boolean).join(' · ')
        : null,
      next: p.nextStep,
      nextOn: iso(p.nextStepOn),
      said: p.source !== 'us' ? p.stageSaid : null,
      implied: p.implied.map((i) => IMPLIED_LABEL[i]),
      setHere: p.statusSource === 'us' && p.statusSetAt ? `set here ${shortDate(p.statusSetAt)}${p.statusSetByName ? ` by ${p.statusSetByName}` : ''}` : null,
      ahead: aheadOfStatus(p, s),
      doNotContact: restricted.has(p.entityId),
      money: c
        ? {
            state: CLOSE_STATE_LABEL[c.state], amount: c.exposure.amount, wired: c.wired, hard: c.exposure.track === 'hard',
            signedPer: c.state === 'signed' && c.signature
              ? c.signature.on ? shortDate(c.signature.on) : `per ${c.signature.bySource === 'affinity' ? 'Affinity' : c.signature.bySource}`
              : null,
          }
        : null,
      meetings: s.meetingDates.length,
      lastMeeting: iso(s.meetingDates[s.meetingDates.length - 1]),
      lastTouch: iso(s.lastTouch),
      waitingSince: iso(s.awaitingSince),
      read: s.read ? READ_LABEL[s.read.read] : null,
      readOn: iso(s.read?.on),
      readSuggested: false,
      rung: rungIndex(p.rung),
      rungs: RUNGS.map((r) => {
        const ev = p.events.find((e) => e.rung === r);
        return ev ? (ev.evidenceKind === 'not_applicable' ? 'na' : 'on') : 'off';
      }),
      rungLabel: p.rung ? RUNG_LABEL[p.rung] : 'Nothing on file',
    };
  });

  const initial = STATUSES.some((s) => s.id === asked) ? (asked as PursuitStatus) : null;
  const count = (s: PursuitStatus) => pursuits.filter((p) => p.status === s).length;

  return (
    <Page
      crumbs={[
        { label: current?.name ?? 'All vehicles', href: '/overview' },
        { label: 'Pipeline' },
      ]}
      inspector={
        <>
          <div className="lbl">Six statuses</div>
          <div className="ihead">Where our effort is</div>
          <div className="imeta">Our plan, set by a person, any direction</div>
          {STATUSES.map((s) => (
            <div className="kv" key={s.id} title={s.means}>
              <span>{s.label}</span>
              <span>{count(s.id).toLocaleString('en-US')}</span>
            </div>
          ))}
          <div className="scope">
            <div className="lbl">What a status is not</div>
            <p>
              Not evidence. The ladder beside each name is what the records support — a reply, a
              meeting, a number, a countersignature, a wire — and a status never moves it. What
              happened is in the log on each LP&rsquo;s page; how far the money has got is the close
              track.
            </p>
          </div>
          <div className="scope">
            <div className="lbl">Searching</div>
            <p>
              Press <kbd>/</kbd> to search. Filters narrow every column at once, and each count then
              reads &ldquo;N of M&rdquo;. Click a column heading to sort by it; click a row to open
              the LP.
            </p>
          </div>
          <div className="note">
            Read from Affinity until someone sets one here; after that, Affinity&rsquo;s word is kept
            beside ours, never over it (docs/17).
          </div>
        </>
      }
    >
      <div className="lbl">Module 04 · Discover &amp; qualify</div>
      <h1>Pipeline</h1>
      <p className="sublede">
        Every LP for {current ? current.name : 'the vehicles being raised'}, by where our effort is.
        The ladder beside each is what the evidence supports, which is not the same thing.
      </p>

      <PipelineTable
        rows={rows}
        statuses={STATUSES.map((s) => ({ id: s.id, label: s.label, means: s.means }))}
        rungNames={RUNGS.map((r) => RUNG_LABEL[r])}
        initialStatus={initial}
        showVehicle={!current}
      />

      <p className="cover" style={{ marginTop: -6 }}>
        {onHistory > 0 && <>{onHistory.toLocaleString('en-US')} pursuits on vehicles kept for their history are not counted here; select one in the rail to see them. </>}
        <b>What this covers:</b> pursuits recorded in this system, including those read from
        Affinity. Someone being worked without a pursuit does not appear, which is a gap in the
        record rather than an absence of activity.
      </p>
    </Page>
  );
}
