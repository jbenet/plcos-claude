import { RestrictedSection, restrictedSection, type RestrictedPageContext } from './sections';
import type { Principal } from '@/lib/authz';
import { StatusForm } from '@/components/strategy/StatusForm';
import { scopedReadData } from './scoped-data';
export { scopedReadData } from './scoped-data';

export async function ScopedReadPage({ user, context = {} }: { user: Principal; context?: RestrictedPageContext }) {
  const data = await scopedReadData(user);
  if (restrictedSection(context.route ?? '')) return <RestrictedSection user={user} data={data} context={context} />;
  return <main style={{ padding: 24 }}>
    <h1>Pipeline · limited access</h1>
    <p>This view shows names, pipeline status, owners, note dates and approach restrictions within your vehicle access. {user.access === 'viewer' ? 'Amounts, note bodies and restriction reasons are hidden.' : 'Amounts, restrictions and vehicle-labelled team notes are shown only for your vehicles. Status changes remain available.'} Licensed fields are hidden.</p>
    <p className="muted">Read from the local database · as of {data.asOf}. {data.outsideScope} pursuits on vehicles outside your access. This page uses a limited view until its full layout supports your access.</p>
    <table><thead><tr><th>LP</th><th>Vehicle</th><th>Owner</th><th>Pipeline status</th><th>Restrictions</th><th>Notes</th>{user.access !== 'viewer' && <><th>Amounts</th><th>Update status</th></>}</tr></thead><tbody>
      {data.rows.map(row => <tr key={row.id}><td>{row.name}{data.overlaps.filter(x => x.entityId === row.entityId).map((x, i) => <small key={i} style={{ display: 'block' }}>Also pursued by {x.vehicle}, owner {x.owner}{x.restricted ? ' · Approach restricted' : ''}</small>)}</td><td>{row.vehicle}</td><td>{row.owner}</td><td>{row.status}</td><td>{row.restricted ? (data.details.find(d => d.id === row.id)?.restriction ?? 'Approach restricted · ask an administrator for the instructions') : 'No current restriction on file'}</td><td>{data.notes.filter(n => n.entityId === row.entityId).map(n => <small key={n.id} style={{ display: 'block' }}>{n.author ?? 'Unattributed'} · {n.at.slice(0, 10)} · {data.bodies.find(b => b.id === n.id)?.body ?? 'body restricted'}</small>)}</td>{user.access !== 'viewer' && <><td>{data.details.filter(d => d.id === row.id && d.amount !== null).map((d, i) => <small key={i} style={{ display: 'block' }}>{d.track}: ${d.amount}</small>)}</td><td>{data.statuses.filter(s => s.id === row.id).map(s => <details key={s.id}><summary>Change status</summary><StatusForm pursuitId={s.id} status={s.status} passedBy={s.passedBy} reason={s.reason} nextStep={s.nextStep} nextStepOn={s.nextStepOn?.slice(0, 10) ?? null} /></details>)}</td></>}</tr>)}
    </tbody></table>
    {!data.rows.length && <p>No pursuits are visible within your vehicle access.</p>}
  </main>;
}
