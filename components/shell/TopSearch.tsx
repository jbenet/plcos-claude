'use client';

import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * The search box in every page's top bar (issue 0135). It searches where you are first, GitHub style: on a list
 * that has its own search (Network's groups, Routes) a chip names that list, and the search runs there. Backspace
 * in the empty box, or the chip's ×, drops the chip and searches everything: names on our records and the app's
 * pages (/search). The chip comes back on the next page.
 */
const GROUPS: Record<string, string> = {
  all: 'Everyone', people: 'People', firms: 'Firms', lps: 'LPs', 'co-funders': 'Co-funders', connectors: 'Connectors',
};

/** The list this page can search itself, and where its search goes. */
function contextOf(path: string): { label: string; action: string } | null {
  const group = /^\/orgs\/g\/([^/]+)$/.exec(path)?.[1];
  if (group && GROUPS[group]) return { label: GROUPS[group]!, action: path };
  if (/^\/(?:[^/]+\/)?routes$/.test(path)) return { label: 'Routes', action: path };
  return null;
}

export function TopSearch() {
  const path = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  // The chip is drawn after mount: the server may see the proxy's rewritten path, the browser the one it asked for.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const context = mounted ? contextOf(path) : null;
  const [scoped, setScoped] = useState(true);
  const [text, setText] = useState('');
  // A new page brings its own context back, and shows the search it is showing.
  useEffect(() => {
    setScoped(true);
    setText(contextOf(path) ? params.get('q') ?? '' : path === '/search' ? params.get('q') ?? '' : '');
  }, [path, params]);
  const chip = scoped ? context : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = text.trim();
    if (chip) router.push(q ? `${chip.action}?${new URLSearchParams({ q })}` : chip.action);
    else if (q) router.push(`/search?${new URLSearchParams({ q })}`);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && chip && !event.currentTarget.value) { event.preventDefault(); setScoped(false); }
    if (event.key === 'Escape') event.currentTarget.blur();
  };

  return (
    <form className="topsearch" role="search" onSubmit={submit}>
      {chip && (
        <span className="chip" title={`Searching ${chip.label}. Backspace in the empty box searches everything.`}>
          {chip.label}
          <button type="button" aria-label={`Search everything, not only ${chip.label}`} onClick={() => setScoped(false)}>×</button>
        </span>
      )}
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={chip ? `Search ${chip.label.toLowerCase()}` : 'Search names and pages'}
        aria-label={chip ? `Search ${chip.label}` : 'Search names and pages'}
      />
    </form>
  );
}
