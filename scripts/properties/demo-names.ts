import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Check } from './harness';

/**
 * The demo seed's names are generated (29 Sep 2026: "demo screenshots must avoid real names —
 * generate random names"). The generator is deterministic, the team's display names come from its
 * lists, and the boundary check that refuses the seed's former names finds a planted one — shown
 * here with an invented name, since the real ones are kept only as hashes.
 */
export async function demoNameProperties(check: Check) {
  const g = await import('../../lib/demo-names');
  const c = await import('../demo-names-check');

  const draw = (seed?: string) => {
    const n = g.demoNames(seed);
    return [n.person(), n.person('f'), n.person('m'), n.firm(), n.firm('Family Office'), n.company(), n.stem()];
  };
  const a = draw(), b = draw(), other = draw('another seed');
  const fresh = g.demoNames();
  const lasts = Array.from({ length: g.LAST_NAMES.length }, () => fresh.last());
  check('Demo names: the same seed draws the same names, another seed others, and no family name twice before the list runs out',
    JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(other) && new Set(lasts).size === lasts.length,
    `${a.slice(0, 3).join(', ')} …; another seed starts ${other[0]}; ${new Set(lasts).size} of ${lasts.length} family names distinct`);

  const users = JSON.parse(await readFile(join(process.cwd(), 'fixtures', 'users.json'), 'utf8')) as Array<{ handle: string; name: string; initials: string }>;
  const firsts = new Set<string>(g.FIRST_NAMES), lastSet = new Set<string>(g.LAST_NAMES);
  const generated = users.every((u) => {
    const [first, ...rest] = u.name.split(' ');
    const initials = u.name.split(' ').map((w) => w[0]).join('');
    return firsts.has(first!) && (rest.length === 0 || lastSet.has(rest.join(' '))) && u.initials === initials;
  });
  check('Demo names: every team member\'s display name is drawn from the generator, and the initials follow it; handles stay for switching',
    generated && users.some((u) => u.handle === 'juan'),
    users.map((u) => `${u.handle}: ${u.name} (${u.initials})`).join('; '));

  const probe = 'Invented Probe-Person';
  const hashes = { person: [c.nameHash(probe)], org: [c.nameHash('Invented Probe Holdings')], token: [c.nameHash('probehandle')] };
  const text = [
    '{ "name": "Invented Probe-Person", "org": "Invented  Probe &  Holdings" }',
    'owner: \'probehandle\', who: \'Probehandle\'',
    '"first": "Inv\\u0065nted Probe-Person"',
  ].join('\n');
  const hits = c.findHashedNames(text, hashes, new Set(['probehandle']));
  const seed = await c.demoRealNameViolations(process.cwd());
  check('Demo names: the check finds a hashed name spelled across spaces, "&" and a JSON escape, lets a lower-case handle through, and the seed has none',
    hits.length === 4 && hits.every((h) => h.line >= 1) && !hits.some((h) => h.text === 'probehandle') && seed.length === 0
      && c.DEMO_REAL_NAME_HASHES.person.length > 0 && c.DEMO_REAL_NAME_HASHES.org.length > 0,
    `probe hits: ${hits.map((h) => `${h.line}:${h.text}`).join(', ')}; demo seed: ${seed.length} former names (${c.DEMO_REAL_NAME_HASHES.person.length + c.DEMO_REAL_NAME_HASHES.org.length + c.DEMO_REAL_NAME_HASHES.token.length} hashed)`);
}
