import { redirect } from 'next/navigation';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { config } from '@/config/deployment';
import { auth } from '@/lib/auth';
import { can } from '@/lib/authz';
import { allAddresses, appendAudit, listPeople, listVehicles } from '@/modules/platform';
import { AddPerson, Addresses, PersonControls, type PersonRow } from './PeopleForms';
import s from './people.module.css';

export const dynamic = 'force-dynamic';

/**
 * Settings → People (docs/deploy/railway.md §3), Admins only: the roster Google sign-in admits. Add a person,
 * change their access and vehicles, deactivate or reactivate them, sign them out everywhere. The last active
 * admin can be neither deactivated nor demoted; an address belongs to one active person. Read-only under the
 * Mac's user switcher, where the roster comes from init.jsonc.
 */
export default async function PeoplePage() {
  const user = await (await auth()).currentUser();
  if (!can(user, 'admin')) {
    await appendAudit({ actorId: user.id, action: 'authz.refused', subjectType: 'page', subjectId: '/settings/people', detail: { access: user.access } }).catch(() => undefined);
    redirect('/access-denied');
  }
  const readOnly = config.auth.provider !== 'google' && config.auth.provider !== 'labos';
  const [people, vehicles, addresses] = await Promise.all([listPeople(), listVehicles(), allAddresses()]);
  const options = vehicles.filter((v) => v.phase !== 'historical').map((v) => ({ id: v.id, name: v.name }));
  const vname = new Map(vehicles.map((v) => [v.id, v.name]));
  const rows: PersonRow[] = people.map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role, access: p.access, vehicles: p.vehicles, active: p.active, you: p.id === user.id, addresses: addresses.get(p.id) ?? [] }));
  const active = rows.filter((r) => r.active);
  const admins = active.filter((r) => r.access === 'admin').length;

  return (
    <Page
      crumbs={[{ label: 'Settings', href: '/settings' }, { label: 'People' }]}
      inspector={
        <>
          <div className="lbl">The roster</div>
          <div className="kv"><span>Active</span><span>{active.length}</span></div>
          <div className="kv"><span>Admins</span><span>{admins}</span></div>
          <div className="kv"><span>Deactivated</span><span>{rows.length - active.length}</span></div>
          <div className="scope">
            <div className="lbl">Who can sign in</div>
            <p>An active person here, signing in with any of their addresses (login, default-to or alias) that is a verified Google Workspace account at its own domain. Nobody signs up: adding someone here is how they get in. We email them at their default-to.</p>
          </div>
          <div className="note">Every change is in the audit log. The last active admin cannot be deactivated or demoted.</div>
        </>
      }
    >
      <div className="lbl">Settings</div>
      <h1>People</h1>
      <p className="sublede">Who can sign in, and what each person may see and do. The server&rsquo;s keys are in <Link href="/settings/connections">Connections</Link>.</p>

      {readOnly && (
        <div className="scope" style={{ marginTop: 0 }}>
          <b>Read-only on this server.</b>
          <p>It uses the user switcher, so anyone on the network could pick an admin: the roster is changed only on a deployed server with sign-in. On the Mac it comes from data/real/init.jsonc.</p>
        </div>
      )}

      <div className="card">
        <div className="chead"><h2>Add a person</h2><span className="lbl">they sign in with Google</span></div>
        <div className="cbody"><AddPerson vehicles={options} readOnly={readOnly} /></div>
      </div>

      <div className="card">
        <div className="chead"><h2>Everyone</h2><span className="lbl">{active.length} active · {rows.length - active.length} deactivated</span></div>
        <div className="cbody">
          <table className={s.table}>
            <thead><tr><th>Person</th><th>Addresses</th><th>Access</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} data-active={p.active}>
                  <td><b>{p.name}</b>{p.you && <span className="flag f-ok" style={{ marginLeft: 8 }}>you</span>}{!p.active && <span className="flag f-mute" style={{ marginLeft: 8 }}>deactivated</span>}<br /><span className={s.muted}>{p.role}</span></td>
                  <td><Addresses p={p} readOnly={readOnly} /></td>
                  <td>{p.access === 'admin' ? 'Admin' : p.access === 'gp' ? 'GP' : 'Viewer'}<br /><span className={s.muted}>{p.access === 'admin' || p.vehicles === null ? 'all vehicles' : p.vehicles.length ? p.vehicles.map((v) => vname.get(v) ?? 'unknown').join(', ') : 'no vehicles'}</span></td>
                  <td><PersonControls p={p} vehicles={options} readOnly={readOnly} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  );
}
