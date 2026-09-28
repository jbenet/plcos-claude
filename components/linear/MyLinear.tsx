import Link from '@/components/ui/AppLink';
import { ago } from '@/lib/time';
import { localToday, myLinear, type Freshness } from '@/modules/linear';
import { IssueList } from './IssueList';
import { LinearTabs } from './LinearTabs';
import s from './linear.module.css';

/**
 * My Linear, on the daily standup (docs/24-linear.md): the signed-in person's issues from our
 * replica of Linear, in progress first, then due this week or overdue, then to do; and a Team tab
 * with everyone's work in progress. Live, never pinned with the day. Read-only: every row opens
 * the issue in Linear.
 */

export function freshnessWord(f: Freshness): { text: string; flag: string | null } {
  if (f.status === 'never' || f.status === 'not_connected' || !f.lastSyncAt) return { text: 'not synced yet', flag: null };
  if (f.status === 'failed') return { text: `last sync stopped · data from ${ago(f.lastSyncAt)}`, flag: 'Last sync stopped' };
  if (f.status === 'stale') return { text: `partial sync ${ago(f.lastSyncAt)}`, flag: 'Partial sync' };
  return { text: `synced ${ago(f.lastSyncAt)}`, flag: null };
}

export async function MyLinear({ user, pinnedDay }: { user: { id: string; handle: string; email: string }; pinnedDay: boolean }) {
  let data;
  try {
    data = await myLinear(user.id);
  } catch {
    return (
      <div className="card">
        <div className="chead"><h2>My Linear</h2><span className="flag f-mute">Source unavailable</span></div>
        <div className="cbody"><p className="muted">The Linear replica could not be read, so nothing is shown rather than an empty list. Reload; Developer → Linear shows the sync.</p></div>
      </div>
    );
  }
  const today = localToday();
  const fresh = freshnessWord(data.freshness);
  const mineCount = data.mine.reduce((n, g) => n + g.issues.length + (g.more ?? 0), 0);
  const matched = data.matched.length > 0;

  const notSynced = (
    <div className={s.empty}>
      <b>Linear hasn’t been read on this server yet.</b> Sync it on <Link href="/dev/linear">Developer → Linear</Link>; this list fills from the copy it keeps.
    </div>
  );
  const mine = !data.synced ? notSynced : !matched ? (
    <div className={s.empty}>
      <b>No Linear member has your address{user.email ? ` (${user.email})` : ''}.</b> If you sign in to Linear with another one, add it as{' '}
      <code>linearEmail</code> on your row of the team in the init file, and this list shows your issues. The Team tab works meanwhile.
    </div>
  ) : (
    <IssueList
      groups={data.mine} today={today} assignee={false} moreHref={data.links.mine}
      empty={<><b>Nothing open is assigned to you in Linear.</b> {data.backlog > 0 ? `${data.backlog} in your backlog.` : ''}</>}
    />
  );
  const team = !data.synced ? notSynced : (
    <IssueList groups={data.team} today={today} moreHref={data.links.team} empty="Nobody on the team has an issue in progress." />
  );

  return (
    <div className="card">
      <LinearTabs
        title={<h2>My Linear</h2>}
        initial={matched || !data.synced ? 'mine' : 'team'}
        extra={fresh.flag ? <span className="flag f-block">{fresh.flag}</span> : <span className={s.fresh}>live · {fresh.text}</span>}
        tabs={[
          { key: 'mine', label: 'Mine', count: mineCount, body: mine },
          { key: 'team', label: 'Team', count: data.teamCount, body: team },
        ]}
      />
      <p className="cover">
        <b>From Linear, read-only{pinnedDay ? ', and live' : ''}.</b>{' '}
        {pinnedDay ? 'Unlike the numbers above, this list is not pinned with the day: it is Linear as of the last sync. ' : ''}
        Mine is in progress, then due within a week or overdue, then to do{data.backlog > 0 ? `; ${data.backlog} more sit in your backlog` : ''}. Team is everyone’s work in progress.
        Every row opens the issue in Linear, where it is changed.
        {fresh.flag ? ` The last sync stopped (${fresh.text}); what it read is shown, and anyone can sync again on Developer → Linear.` : ''}
      </p>
    </div>
  );
}
