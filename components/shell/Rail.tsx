import Link from 'next/link';
import { auth } from '@/lib/auth';
import { issues as issueSink } from '@/lib/issues';
import { ticketCounts } from '@/modules/governance';
import { vehicleSelection } from '@/lib/session';
import { NavList } from './NavList';
import { UserSwitcher } from './UserSwitcher';
import { VehicleSwitcher } from './VehicleSwitcher';

export async function Rail() {
  const a = await auth();
  const [user, users, vehicles, open, tickets] = await Promise.all([
    a.currentUser(),
    a.listUsers(),
    vehicleSelection(),
    issueSink().then((s) => s.list({ status: ['open', 'triaged', 'agent-ready', 'in-progress', 'review'] })),
    ticketCounts(),
  ]);

  return (
    <nav className="rail">
      <Link className="brand" href="/today">
        <div className="mark">C</div>
        <b>Capital&nbsp;OS</b>
      </Link>

      <VehicleSwitcher current={vehicles.current} all={vehicles.all} />
      <NavList approvals={tickets.open} issues={open.length} />

      <div className="railfoot">
        <Link className="sub" href="/agents" style={{ padding: '6px 10px', marginBottom: 2 }}>
          <span className="nm">Agent quality</span>
          <span className="ct">L13</span>
        </Link>
        <Link className="sub" href="/system" style={{ padding: '6px 10px', marginBottom: 6 }}>
          <span className="nm">System &amp; seams</span>
          <span className="ct">L1</span>
        </Link>
        <UserSwitcher user={user} users={users} />
      </div>
    </nav>
  );
}
