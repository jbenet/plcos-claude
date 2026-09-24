'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  moduleHref, modulesForKind, OVERVIEW_SECTION, STATIC_SECTIONS, type NavSection,
} from '@/lib/nav';

/**
 * The rail deliberately does not carry the exemption. 506(b) versus 506(c) decides what
 * may be sent to whom and who must be verified — it is the first fact on the vehicle's
 * overview, not a five-character suffix on a nav row.
 */
export interface NavVehicle {
  slug: string;
  name: string;
  kind: string;
  /** A vehicle that did not close, kept for its history. */
  historical?: boolean;
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
  vehicles, current: cookieVehicle, approvals, issues,
}: {
  vehicles: NavVehicle[];
  current: string | null;
  approvals: number;
  issues: number;
}) {
  const path = usePathname();
  const router = useRouter();

  /**
   * A scoped module carries the vehicle in the URL, so the URL wins over the cookie. Left
   * to the cookie the rail would say "All vehicles" while the page said Neurotech, which
   * is the kind of quiet disagreement that makes a reader stop trusting the chrome.
   */
  const [, seg1, seg2] = path.split('/');
  // Every vehicle module carries its vehicle in the path now (N65), and so does the overview.
  const isModule = (s: string | undefined) => Boolean(s) && (s === 'overview' || modulesForKind('fund').some((mod) => mod.path === s) || s === 'spv' || s === 'grants');
  const fromPath = isModule(seg2) ? (seg1 === 'all' ? null : seg1 ?? null) : undefined;
  const current = fromPath === undefined ? cookieVehicle : fromPath;
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

  /**
   * Selecting a vehicle keeps you on the same module rather than throwing you back to the
   * overview. For a scoped module the slug is in the path, so switching vehicles is a
   * navigation; for the rest it is still the cookie, so it is a POST and a refresh.
   */
  const selectVehicle = (slug: string) => {
    const segment = path.split('/')[2];
    const stay = isModule(segment) ? segment! : 'overview';
    start(async () => {
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vehicleSlug: slug }),
      });
      router.push(`/${slug}/${stay}`);
      router.refresh();
    });
  };

  const Section = ({
    section, badge, children,
  }: {
    section: NavSection;
    /** Shown on the heading while the section is closed, so a count is never hidden. */
    badge?: number;
    children: React.ReactNode;
  }) => {
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
          {isCollapsed && badge ? <span className="pip">{badge}</span> : null}
          <span className="caret" suppressHydrationWarning>
            {isCollapsed ? '▸' : '▾'}
          </span>
        </button>
        {!isCollapsed && <div suppressHydrationWarning>{children}</div>}
      </div>
    );
  };

  const capital: NavSection = { id: 'capital', title: 'PL Capital', links: [] };

  /**
   * The grants rail is a vehicle, but it belongs to PL R&D rather than PL Capital — that
   * is where the work actually sits. The row behaves identically wherever it is drawn.
   */
  const VehicleRow = ({ v }: { v: NavVehicle }) => {
    const selected = current === v.slug;
    return (
      <div>
        <button
          className={`sub vehicle${selected ? ' on' : ''}`}
          onClick={() => selectVehicle(v.slug)}
        >
          <span className="nm">{v.name}</span>
        </button>
        {selected && (
          <div className="submods">
            {modulesForKind(v.kind).map((mod) => {
              const href = moduleHref(mod, v.slug);
              return (
                <Link
                  key={mod.slug}
                  href={href}
                  title={mod.mechanic}
                  className={`subsub${on(href) ? ' on' : ''}`}
                >
                  {mod.title}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const capitalVehicles = vehicles.filter((v) => v.kind !== 'grant_rail');
  const rndVehicles = vehicles.filter((v) => v.kind === 'grant_rail');

  return (
    <div className="nav" data-hydrated={hydrated}>
      <Section section={OVERVIEW_SECTION} badge={approvals}>
        {OVERVIEW_SECTION.links.map((l) => (
          <Link key={l.href} className={`sub${on(l.href) ? ' on' : ''}`} href={l.href}>
            <span className="nm">{l.label}</span>
            {l.href === '/approvals' && (
              approvals > 0
                ? <span className="pip">{approvals}</span>
                : <span className="ct">0</span>
            )}
            {(l.href === '/issues' || l.href === '/developer/issues') && <span className="ct">{issues}</span>}
          </Link>
        ))}
      </Section>

      <Section section={capital}>
        <Link className={`sub${on('/operations') ? ' on' : ''}`} href="/operations">
          <span className="nm">Operations</span>
        </Link>

        {capitalVehicles.map((v) => <VehicleRow key={v.slug} v={v} />)}

        <button
          className={`sub vehicle${current === null ? ' on' : ''}`}
          onClick={() => selectVehicle('all')}
        >
          <span className="nm">All vehicles</span>
          <span className="ct">{vehicles.length}</span>
        </button>
        {current === null && (
          <div className="submods">
            {modulesForKind('fund').map((mod) => {
              const href = moduleHref(mod, null);
              return (
                <Link
                  key={mod.slug}
                  href={href}
                  title={mod.mechanic}
                  className={`subsub${on(href) ? ' on' : ''}`}
                >
                  {mod.title}
                </Link>
              );
            })}
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
          {section.id === 'rnd' && rndVehicles.map((v) => <VehicleRow key={v.slug} v={v} />)}
        </Section>
      ))}
    </div>
  );
}
