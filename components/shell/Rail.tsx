import Link from 'next/link';
import { config } from '@/config/deployment';
import { auth } from '@/lib/auth';
import { issues as issueSink } from '@/lib/issues';
import { vehicleSelection } from '@/lib/session';
import { ticketCounts } from '@/modules/governance';
import { NavList } from './NavList';
import { UserSwitcher } from './UserSwitcher';
import { FeedbackButton } from './FeedbackBox';

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
        <div className="mark">{config.product.mark}</div>
        <b>{config.product.name}</b>
      </Link>

      <NavList
        vehicles={vehicles.all.map((v) => ({
          slug: v.slug, name: v.name, kind: v.kind,
        }))}
        current={vehicles.current?.slug ?? null}
        approvals={tickets.open}
        issues={open.length}
      />

      <div className="railfoot">
        <div className="railrow">
          <FeedbackButton variant="rail" />
          <Link className="railgear" href="/settings" aria-label="Your settings" title="Your settings">
            <span aria-hidden>⚙</span>
          </Link>
        </div>
        <UserSwitcher user={user} users={users} />
      </div>
    </nav>
  );
}
