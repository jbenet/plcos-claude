'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { modulesForKind, STATIC_SECTIONS, type NavSection } from '@/lib/nav';

export interface NavVehicle {
  slug: string;
  name: string;
  kind: string;
  exemption: string;
}

const STORE_KEY = 'capitalos.nav.collapsed';

/**
 * The left rail.
 *
 * Vehicles are rows that change scope, not links: clicking one sets the selected vehicle
 * and opens its module submenu. Sections collapse, and the choice is remembered — a
 * preference that resets on every reload is not a preference.
 */
export function NavList({
  vehicles, current, approvals, issues,
}: {
  vehicles: NavVehicle[];
  current: string | null;
  approvals: number;
  issues: number;
}) {
  const path = usePathname();
  const router = useRouter();
  const [, start] = useTransition();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(STATIC_SECTIONS.filter((s) => s.defaultCollapsed).map((s) => [s.id, true])),
  );
  const [hydrated, setHydrated] = useState(false);

  // Read the stored preference after mount: the server cannot know it, and rendering the
  // default first avoids a hydration mismatch.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) setCollapsed(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* private window, blocked storage — defaults are fine */
    }
    setHydrated(true);
  }, []);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch {
        /* nothing to do; the session still works */
      }
      return next;
    });
  };

  const on = (href: string) => path === href || path.startsWith(href + '/');

  const selectVehicle = (slug: string) => {
    start(async () => {
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vehicleSlug: slug }),
      });
      router.push('/overview');
      router.refresh();
    });
  };

  const Section = ({ section, children }: { section: NavSection; children: React.ReactNode }) => {
    const isCollapsed = Boolean(collapsed[section.id]);
    return (
      <div className="navsec">
        <button
          className="sec"
          onClick={() => toggle(section.id)}
          aria-expanded={!isCollapsed}
          suppressHydrationWarning
        >
          <span>{section.title}</span>
          <span className="caret" suppressHydrationWarning>
            {isCollapsed ? '▸' : '▾'}
          </span>
        </button>
        {!isCollapsed && <div suppressHydrationWarning>{children}</div>}
      </div>
    );
  };

  const capital: NavSection = { id: 'capital', title: 'PL Capital', links: [] };

  return (
    <div className="nav" data-hydrated={hydrated}>
      <div className="navsec">
        <Link className={`nitem${on('/today') ? ' on' : ''}`} href="/today">
          Today
        </Link>
        <Link className={`nitem${on('/approvals') ? ' on' : ''}`} href="/approvals">
          Approvals
          {approvals > 0 ? <span className="pip">{approvals}</span> : <span className="ct">0</span>}
        </Link>
        <Link className={`nitem${on('/issues') ? ' on' : ''}`} href="/issues">
          Issues<span className="ct">{issues}</span>
        </Link>
      </div>

      <Section section={capital}>
        <Link className={`sub${on('/operations') ? ' on' : ''}`} href="/operations">
          <span className="nm">Operations</span>
        </Link>

        {vehicles.map((v) => {
          const selected = current === v.slug;
          return (
            <div key={v.slug}>
              <button
                className={`sub vehicle${selected ? ' on' : ''}`}
                onClick={() => selectVehicle(v.slug)}
              >
                <span className="nm">{v.name}</span>
                <span className="ct">{v.exemption === 'n/a' ? '' : v.exemption}</span>
              </button>
              {selected && (
                <div className="submods">
                  {modulesForKind(v.kind).map((mod) => (
                    <Link
                      key={mod.slug}
                      href={mod.href}
                      title={mod.mechanic}
                      className={`subsub${on(mod.href) ? ' on' : ''}`}
                    >
                      {mod.title}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <button
          className={`sub vehicle${current === null ? ' on' : ''}`}
          onClick={() => selectVehicle('all')}
        >
          <span className="nm">All vehicles</span>
          <span className="ct">{vehicles.length}</span>
        </button>
        {current === null && (
          <div className="submods">
            {modulesForKind('fund').map((mod) => (
              <Link
                key={mod.slug}
                href={mod.href}
                title={mod.mechanic}
                className={`subsub${on(mod.href) ? ' on' : ''}`}
              >
                {mod.title}
              </Link>
            ))}
          </div>
        )}
      </Section>

      {STATIC_SECTIONS.map((section) => (
        <Section key={section.id} section={section}>
          {section.links.map((l) => (
            <Link key={l.href} className={`sub${on(l.href) ? ' on' : ''}`} href={l.href}>
              <span className="nm">{l.label}</span>
              {l.hint && <span className="ct">{l.hint}</span>}
            </Link>
          ))}
        </Section>
      ))}
    </div>
  );
}
