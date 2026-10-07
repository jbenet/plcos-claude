'use client';

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import Link from '@/components/ui/AppLink';
import { usePathname, useRouter } from 'next/navigation';
import {
  moduleHref, modulesForKind, OVERVIEW_SECTION, STATIC_SECTIONS, WIP_MODULES, type NavSection,
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
/** Where the rail was scrolled to, for this tab (issue 0133). */
const SCROLL_KEY = 'capitalos.nav.scroll';

/**
 * The left rail.
 *
 * Vehicles are rows that change scope, not links: clicking one sets the selected vehicle
 * and opens its module submenu. Sections collapse, and the choice is remembered — a
 * preference that resets on every reload is not a preference.
 */
export function NavList({
  vehicles, current: cookieVehicle, asked, approvals, issues,
}: {
  vehicles: NavVehicle[];
  current: string | null;
  /** The address the browser asked for, when the proxy rewrote it (null otherwise). */
  asked?: string | null;
  approvals: number;
  issues: number;
}) {
  /**
   * On the server, usePathname() is the path the proxy rewrote to (/targets), while the browser
   * has the address it asked for (/neurotech/pipeline): the rail marked different links on each
   * side and React refused to hydrate (issue 0011, real). The server uses the asked-for address,
   * which is exactly what the browser's first render reads, and every render after follows the
   * router — so the two sides always agree.
   */
  const routed = usePathname();
  const path = typeof window === 'undefined' ? (asked ?? routed) : routed;
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

  /**
   * The rail keeps its place (issue 0133): the scroll is remembered as it changes and put back on
   * mount (a reload, or the rail drawn again) and after each navigation, in case anything moved it.
   */
  const scroller = useRef<HTMLDivElement>(null);
  const scrollTop = useRef<number | null>(null);
  const remember = () => {
    const top = scroller.current?.scrollTop ?? 0;
    scrollTop.current = top;
    try { window.sessionStorage.setItem(SCROLL_KEY, String(Math.round(top))); } catch { /* blocked storage */ }
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (scrollTop.current === null) {
      try { scrollTop.current = Number(window.sessionStorage.getItem(SCROLL_KEY)) || 0; } catch { scrollTop.current = 0; }
    }
    if (Math.abs(el.scrollTop - scrollTop.current) > 1) el.scrollTop = scrollTop.current;
  }, [path, hydrated]);

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

  /**
   * Plain functions, not components (issue 0133): a component defined inside this one is a new
   * type on every render, so each navigation threw away and rebuilt every section, closing the
   * open WIP group and losing the rail's place.
   */
  const navSection = (
    section: NavSection,
    /** Shown on the heading while the section is closed, so a count is never hidden. */
    badge: number | undefined,
    children: React.ReactNode,
  ) => {
    const isCollapsed = Boolean(collapsed[section.id]);
    return (
      <div className="navsec" key={section.id}>
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
  const vehicleRow = (v: NavVehicle) => {
    const selected = current === v.slug;
    return (
      <div key={v.slug}>
        <button
          className={`sub vehicle${selected ? ' on' : ''}`}
          onClick={() => selectVehicle(v.slug)}
        >
          <span className="nm">{v.name}</span>
        </button>
        {selected && vehicleModules(v.kind, v.slug)}
      </div>
    );
  };

  const vehicleModules = (kind: string, slug: string | null) => {
    const modules = modulesForKind(kind, slug ?? undefined);
    const link = (mod: (typeof modules)[number]) => {
      const href = moduleHref(mod, slug);
      return <Link key={mod.slug} href={href} title={mod.mechanic}
        aria-current={on(href) ? 'page' : undefined}
        className={`subsub${on(href) ? ' on' : ''}`}>{mod.title}</Link>;
    };
    const wip = modules.filter((mod) => WIP_MODULES.has(mod.slug));
    const active = wip.some((mod) => on(moduleHref(mod, slug)));
    return <div className="submods">
      {modules.filter((mod) => !WIP_MODULES.has(mod.slug)).map(link)}
      <details className={`nav-wip${active ? ' has-current' : ''}`}>
        <summary>WIP pages{active && <span>Current page</span>}</summary>
        {wip.map(link)}
      </details>
    </div>;
  };

  const capitalVehicles = vehicles.filter((v) => v.kind !== 'grant_rail');
  const rndVehicles = vehicles.filter((v) => v.kind === 'grant_rail');

  return (
    <div className="nav" data-hydrated={hydrated} ref={scroller} onScroll={remember}>
      {navSection(OVERVIEW_SECTION, approvals, <>
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
      </>)}

      {navSection(capital, undefined, <>
        <Link className={`sub${on('/operations') ? ' on' : ''}`} href="/operations">
          <span className="nm">Operations</span>
        </Link>

        {capitalVehicles.map(vehicleRow)}

        <button
          className={`sub vehicle${current === null ? ' on' : ''}`}
          onClick={() => selectVehicle('all')}
        >
          <span className="nm">All vehicles</span>
          <span className="ct">{vehicles.length}</span>
        </button>
        {current === null && vehicleModules('fund', null)}
      </>)}

      {STATIC_SECTIONS.map((section) => navSection(section, undefined, <>
          {section.links.map((l) => (
            <Link key={l.href} className={`sub${on(l.href) ? ' on' : ''}`} href={l.href}>
              <span className="nm">{l.label}</span>
              {l.hint && <span className="ct">{l.hint}</span>}
            </Link>
          ))}
          {section.id === 'rnd' && rndVehicles.map(vehicleRow)}
      </>))}
    </div>
  );
}
