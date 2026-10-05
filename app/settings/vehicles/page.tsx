import { redirect } from 'next/navigation';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { auth } from '@/lib/auth';
import { can } from '@/lib/authz';
import { appendAudit, listVehicles } from '@/modules/platform';
import { AddVehicle } from './VehicleForm';
import { vehiclesWritable } from './writable';
import s from '../people/people.module.css';

export const dynamic = 'force-dynamic';

const KIND = { fund: 'Fund', spv: 'SPV', grant_rail: 'Grant rail' } as const;
const money = (n: number | null) => n === null ? 'no target' : n >= 1e6 ? `$${(n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M` : `$${n.toLocaleString('en-US')}`;

/**
 * Settings → Vehicles, Admins only: every vehicle, and Add a vehicle (5 Oct 2026). On the cloud server the
 * init file sits on a volume nobody edits, so a new SPV is added here; the row is the one the init file would
 * write (modules/platform/vehicles.ts), and an init reload that does not name it leaves it alone.
 */
export default async function VehiclesPage() {
  const user = await (await auth()).currentUser();
  if (!can(user, 'admin')) {
    await appendAudit({ actorId: user.id, action: 'authz.refused', subjectType: 'page', subjectId: '/settings/vehicles', detail: { access: user.access } }).catch(() => undefined);
    redirect('/access-denied');
  }
  const refusal = vehiclesWritable();
  const vehicles = await listVehicles();
  const active = vehicles.filter((v) => v.phase !== 'historical');

  return (
    <Page
      crumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Vehicles' }]}
      inspector={
        <>
          <div className="lbl">The vehicles</div>
          <div className="kv"><span>Active</span><span>{active.length}</span></div>
          <div className="kv"><span>Historical</span><span>{vehicles.length - active.length}</span></div>
          <div className="scope">
            <div className="lbl">Where they come from</div>
            <p>The init file, and this page. A vehicle added here is the same row the file would write. Reloading the file updates a vehicle it names and leaves the others alone: it never deletes one.</p>
          </div>
          <div className="note">Each vehicle added here is in the audit log, with who added it.</div>
        </>
      }
    >
      <div className="lbl">Settings</div>
      <h1>Vehicles</h1>
      <p className="sublede">The funds, SPVs and grant rail this raise runs. Who may see each one is in <Link href="/settings/people">People</Link>.</p>

      {refusal && (
        <div className="scope" style={{ marginTop: 0 }}>
          <b>Read-only on this server.</b>
          <p>{refusal}</p>
        </div>
      )}

      <div className="card">
        <div className="chead"><h2>Add a vehicle</h2><span className="lbl">admins · it shows in the rail at once</span></div>
        <div className="cbody"><AddVehicle readOnly={Boolean(refusal)} taken={vehicles.map((v) => v.slug)} /></div>
      </div>

      <div className="card">
        <div className="chead"><h2>Every vehicle</h2><span className="lbl">{active.length} active · {vehicles.length - active.length} historical</span></div>
        <div className="cbody">
          <table className={s.table}>
            <thead><tr><th>Vehicle</th><th>Kind</th><th>Exemption</th><th>Target</th></tr></thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id} data-active={v.phase !== 'historical'}>
                  <td><Link href={`/${v.slug}/overview`}><b>{v.name}</b></Link>{v.phase === 'historical' && <span className="flag f-mute" style={{ marginLeft: 8 }}>historical</span>}<br /><span className={`${s.muted} mono`}>{v.slug}</span></td>
                  <td>{KIND[v.kind]}</td>
                  <td className="mono">{v.exemption}</td>
                  <td>{money(v.targetAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  );
}
