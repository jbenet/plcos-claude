import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/config/deployment';
import { latestRaw } from '@/modules/sources';
import { discovered, initForMatching } from './discover';
import { matchLists } from './match';

/**
 * Two lists for one vehicle (N45): who is on the older one but not the one in use.
 *
 * Juan, 23 Sep: the Neurotech "Fundraising" list is old and unused, and the LP Pipeline is the
 * one to trust. Before anything treats the old list as history, find its LPs that the Pipeline
 * does not have — by the same person, or failing that the same organization — so they can be
 * moved across rather than lost. The first list the init file names for a vehicle is the one in
 * use; every other one is compared against it.
 *
 * The page shows counts. The names are in the report, in data/<profile>/reports/, where they
 * stay.
 */

interface V { type: string; data: unknown }
interface F { id: string; name: string; type: string; value: V | null }
interface E { id: number; type: 'person' | 'company' | 'opportunity'; listId: number; createdAt: string; entity: { id: number; name?: string; firstName?: string; lastName?: string | null; fields?: F[] } }
interface Ref { id: number; name: string }

export interface Uncovered {
  entryId: number;
  name: string;
  status: string | null;
  owners: string[];
  people: string[];
  organizations: string[];
  added: string;
}

export interface Comparison {
  vehicle: string;
  primary: string;
  secondary: string;
  total: number;
  byPerson: number;
  byOrganization: number;
  /** Linked to people or organizations, none of whom the primary list has. */
  missing: Uncovered[];
  /** Linked to nobody, so there is nothing to match on but a name. */
  unlinked: Uncovered[];
}

const nameOf = (p: { firstName?: string | null; lastName?: string | null; name?: string }) =>
  p.name ?? ([p.firstName, p.lastName].filter(Boolean).join(' ') || 'unnamed');
const refs = (v: V | null): Array<Ref & { type?: string }> => {
  if (!v || v.data === null || v.data === undefined) return [];
  const xs = (Array.isArray(v.data) ? v.data : [v.data]) as Array<{ id: number; type?: string; name?: string; firstName?: string; lastName?: string | null }>;
  return xs.filter(Boolean).map((x) => ({ id: x.id, name: nameOf(x), type: x.type }));
};

export async function compareLists(): Promise<Comparison[]> {
  const [{ lists }, init, raw] = await Promise.all([discovered(), initForMatching(), latestRaw<E>('affinity', 'list_entry')]);
  if (!init) return [];
  const entries = raw.map((r) => r.payload);
  const matches = matchLists(init, lists);
  const out: Comparison[] = [];
  for (const v of init.vehicles) {
    const mine = matches.filter((m) => m.vehicleSlug === v.slug && m.list);
    if (mine.length < 2) continue;
    const primary = mine[0]!.list!;
    const inPrimary = entries.filter((e) => e.listId === primary.id);
    const people = new Set<number>();
    const orgs = new Set<number>();
    for (const e of inPrimary) {
      if (e.type === 'person') people.add(e.entity.id);
      if (e.type === 'company') orgs.add(e.entity.id);
      for (const f of e.entity.fields ?? []) {
        if (!f.value) continue;
        if (/^company/.test(f.value.type)) for (const c of refs(f.value)) orgs.add(c.id);
        if (e.type !== 'person' && /^person/.test(f.value.type)) for (const p of refs(f.value)) if (p.type !== 'internal') people.add(p.id);
      }
    }
    for (const m of mine.slice(1)) {
      const list = m.list!;
      const c: Comparison = { vehicle: v.name, primary: primary.name, secondary: list.name, total: 0, byPerson: 0, byOrganization: 0, missing: [], unlinked: [] };
      for (const e of entries.filter((x) => x.listId === list.id)) {
        c.total++;
        const fields = e.entity.fields ?? [];
        const linkedPeople = e.type === 'person' ? [{ id: e.entity.id, name: nameOf(e.entity) }] : fields.filter((f) => /^person/.test(f.value?.type ?? '')).flatMap((f) => refs(f.value)).filter((p) => p.type !== 'internal');
        const linkedOrgs = e.type === 'company' ? [{ id: e.entity.id, name: nameOf(e.entity) }] : fields.filter((f) => /^company/.test(f.value?.type ?? '')).flatMap((f) => refs(f.value));
        if (linkedPeople.some((p) => people.has(p.id))) { c.byPerson++; continue; }
        if (linkedOrgs.some((o) => orgs.has(o.id))) { c.byOrganization++; continue; }
        const status = fields.find((f) => /dropdown/.test(f.value?.type ?? '') && /status|stage/i.test(f.name));
        const owners = fields.filter((f) => /^person/.test(f.value?.type ?? '')).flatMap((f) => refs(f.value)).filter((p) => p.type === 'internal').map((p) => p.name);
        const row: Uncovered = {
          entryId: e.id,
          name: nameOf(e.entity),
          status: (status?.value?.data as { text?: string } | null)?.text ?? null,
          owners: [...new Set(owners)],
          people: [...new Set(linkedPeople.map((p) => p.name))],
          organizations: [...new Set(linkedOrgs.map((o) => o.name))],
          added: e.createdAt.slice(0, 10),
        };
        (linkedPeople.length || linkedOrgs.length ? c.missing : c.unlinked).push(row);
      }
      out.push(c);
    }
  }
  return out;
}

/** The names, in a file that stays in data/<profile>/reports/. */
export async function writeComparison(cs: Comparison[], at = new Date()): Promise<string> {
  const dir = join(config.data.root, 'reports');
  await mkdir(join(process.cwd(), dir), { recursive: true });
  const file = join(dir, `lists-compared-${at.toISOString().slice(0, 10)}.md`);
  const lines = [
    `# Lists compared — ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `Profile: ${config.data.profile}. For each vehicle with more than one list: entries on the older list whose people and organizations the list in use does not have. Candidates to move across, not moved.`,
    '',
  ];
  const row = (u: Uncovered) =>
    `| ${u.name.replace(/\|/g, '/')} | ${u.status ?? '—'} | ${u.owners.join(', ') || '—'} | ${u.people.join(', ') || '—'} | ${u.organizations.join(', ') || '—'} | ${u.added} |`;
  for (const c of cs) {
    lines.push(`## ${c.vehicle}: “${c.secondary}” against “${c.primary}”`, '');
    lines.push(`${c.total} entries. ${c.byPerson} have a person on “${c.primary}”, ${c.byOrganization} more an organization. **${c.missing.length}** are linked to people or organizations it does not have, and **${c.unlinked.length}** are linked to nobody.`, '');
    for (const [title, xs] of [['Not on the list in use', c.missing], ['Linked to nobody — match by name, by hand', c.unlinked]] as const) {
      if (!xs.length) continue;
      lines.push(`### ${title} (${xs.length})`, '', '| Entry | Status | Owners | People | Organizations | Added |', '|---|---|---|---|---|---|');
      for (const u of xs) lines.push(row(u));
      lines.push('');
    }
  }
  await writeFile(join(process.cwd(), file), lines.join('\n') + '\n');
  return file;
}
