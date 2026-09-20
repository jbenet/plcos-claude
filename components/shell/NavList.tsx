'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SECTIONS } from '@/lib/nav';

export function NavList({ approvals, issues }: { approvals: number; issues: number }) {
  const path = usePathname();
  const on = (href: string) => path === href || path.startsWith(href + '/');

  return (
    <div className="nav">
      <Link className={`nitem${on('/today') ? ' on' : ''}`} href="/today">
        Today
      </Link>
      <Link className={`nitem${on('/approvals') ? ' on' : ''}`} href="/approvals">
        Approvals
        {approvals > 0 ? <span className="pip">{approvals}</span> : <span className="ct">L3</span>}
      </Link>
      <Link className={`nitem${on('/issues') ? ' on' : ''}`} href="/issues">
        Issues<span className="ct">{issues}</span>
      </Link>

      {SECTIONS.map((s) => (
        <div key={s.title}>
          <div className="sec">
            <span>{s.title}</span>
            <span>{s.range}</span>
          </div>
          {s.modules.map((mod) => (
            <Link
              key={mod.slug}
              href={mod.href}
              title={mod.mechanic}
              className={`sub${on(mod.href) ? ' on' : ''}${mod.built ? '' : ' later'}`}
            >
              <span className="nm">{mod.title}</span>
              <span className="ct">{mod.built ? '' : mod.stage}</span>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}
