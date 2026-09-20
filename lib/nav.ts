/**
 * The navigation model.
 *
 * Project-oriented, not module-oriented. The question a person arrives with is "what is
 * happening on Neurotech", not "where is the soft/hard cockpit" — so vehicles are the
 * top-level structure and the modules are what you find inside one.
 *
 * The vehicle a module is scoped to lives in a cookie rather than the URL. That keeps the
 * twenty module routes unchanged and every internal link working, at the cost of a URL you
 * cannot share vehicle-scoped. See CHANGELOG under N1 — it is a real trade-off, not an
 * oversight.
 */

export type Stage =
  | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7'
  | 'L8' | 'L9' | 'L10' | 'L11' | 'L12' | 'L13';

export interface NavModule {
  num: string;
  title: string;
  slug: string;
  href: string;
  stage: Stage;
  built: boolean;
  mechanic: string;
  /** Which vehicle kinds this module makes sense for. Empty = all of them. */
  kinds?: Array<'fund' | 'spv' | 'grant_rail'>;
}

const m = (
  num: string, title: string, slug: string, stage: Stage, mechanic: string,
  built = true, kinds?: NavModule['kinds'],
): NavModule => ({ num, title, slug, stage, mechanic, built, href: built ? `/${slug}` : `/m/${slug}`, kinds });

/**
 * The modules that answer a question about one vehicle. These appear as a submenu under
 * whichever vehicle is selected.
 */
export const VEHICLE_MODULES: NavModule[] = [
  m('04', 'Conversion strategy', 'targets', 'L5', 'The per-target workspace; consent ladder; coverage disclosure.'),
  m('05', 'Warm intro routes', 'routes', 'L4', 'Route ranking by connector credibility; A–D evidence tiers; non-circumvention.'),
  m('03', 'Selection', 'selection', 'L9', 'The capacity/affinity/propensity rubric, with weights visible and editable.'),
  m('07', 'Ask coordination', 'asks', 'L3', 'One owner per relationship; frequency guard; conflict cases with a dated follow-up.'),
  m('11', 'Meetings', 'meetings', 'L11', 'Prep brief, objection tagging, and the rung a reply actually justifies.'),
  m('10', 'Decision room', 'decisions', 'L11', 'Diligence questions, objections, evidence gaps, decision timeline.'),
  m('08', 'Soft → Hard', 'soft-hard', 'L6', 'Two separate tracks. Convertible soft is shown and never added to hard.'),
  m('09', 'Vehicle status', 'vehicles', 'L6', 'Per-vehicle pipeline, velocity, and how the bottleneck moved.'),
  m('16', 'Materials & send gate', 'materials', 'L12', 'SEND ticket; wrong-wrap matrix; staleness.'),
  m('18', 'Close room', 'close', 'L8', 'Fund-cycle close: subscription pack, conditions, committee clock.', true, ['fund']),
  m('19', 'SPV war room', 'spv', 'L8', 'invite → IOI → allocate → wire, with days-to-wire as the headline.', true, ['spv']),
  m('20', 'Grants rail', 'grants', 'L13', 'No-unsolicited gate until a funder invitation exists.', true, ['grant_rail']),
  m('24', 'Compliance', 'compliance', 'L13', 'Accreditation, public claims, the solicitation log and side-letter risk.'),
];

export function modulesForKind(kind: string): NavModule[] {
  return VEHICLE_MODULES.filter((x) => !x.kinds || x.kinds.includes(kind as 'fund'));
}

export interface NavLink {
  label: string;
  href: string;
  /** Rendered small and muted on the right of the row. */
  hint?: string;
}

export interface NavSection {
  id: string;
  title: string;
  /** Developer starts collapsed so a first-time user is not handed the plumbing. */
  defaultCollapsed?: boolean;
  links: NavLink[];
  /** True for PL Capital, whose vehicle rows switch scope rather than just navigating. */
  vehicles?: boolean;
}

/** Sections whose contents do not depend on the database. */
export const STATIC_SECTIONS: NavSection[] = [
  {
    id: 'rnd',
    title: 'PL R&D',
    links: [
      { label: 'Operations', href: '/rnd' },
      { label: 'PL Neuro', href: '/rnd/neuro' },
    ],
  },
  {
    id: 'relationships',
    title: 'Relationships',
    links: [
      { label: 'LPs', href: '/relationships/lps' },
      { label: 'Co-funders', href: '/relationships/co-funders' },
      { label: 'All', href: '/relationships/all' },
    ],
  },
  {
    id: 'other',
    title: 'Other',
    links: [
      { label: 'Research & enrichment', href: '/research' },
      { label: 'Forecast', href: '/forecast' },
      { label: 'Sprint calendar', href: '/calendar' },
      { label: 'Content studio', href: '/content' },
      { label: 'Content performance', href: '/performance' },
      { label: 'Answer library', href: '/library' },
      { label: 'Capabilities without a screen', href: '/m/lp-fit' },
    ],
  },
  {
    id: 'developer',
    title: 'Developer',
    defaultCollapsed: true,
    links: [
      { label: 'Changelog', href: '/dev/changelog' },
      { label: 'Status', href: '/dev/status' },
      { label: 'Settings', href: '/dev/settings' },
      { label: 'Modules', href: '/dev/modules' },
      { label: 'Agents', href: '/agents' },
      { label: 'Connectors', href: '/dev/connectors' },
      { label: 'Logs', href: '/dev/logs' },
      { label: 'Feedback', href: '/dev/feedback' },
    ],
  },
];

/**
 * Modules that are a capability rather than a screen. Reachable at /m/<slug>, where the
 * page says what the capability is and where its output already appears.
 */
export const PLAYBOOK_ONLY: Array<{ num: string; title: string; slug: string; why: string; where: string }> = [
  {
    num: '02', title: 'Segmentation', slug: 'segmentation',
    why: 'Rule-built audiences from explicit criteria, not clustering. It earns a screen when a rule set needs editing more than once a week.',
    where: 'Selection ranks the universe for one vehicle, which is the only segment anybody has asked for so far.',
  },
  {
    num: '06', title: 'Signals', slug: 'signals',
    why: 'External change detection. The model, the thresholds and the ingest path are real; a dedicated page before a connector exists would render invented change detection.',
    where: 'Today, the target workspace, and Developer → Status, where the thresholds and everything they held back are listed.',
  },
  {
    num: '12', title: 'LP-fit audit', slug: 'lp-fit',
    why: 'Per-vehicle legibility gaps: what makes this hard for an LP to evaluate. It is an output format over material that already exists.',
    where: 'The prep brief already names every claim it refuses to make, which is the audit for one target at a time.',
  },
  {
    num: '23', title: 'Team capacity', slug: 'capacity',
    why: 'Role × vehicle slots and a principal-time floor. One person does not need a screen for this yet.',
    where: 'The SPV war room names who is split between an SPV clock and the fund close, which is the part that currently bites.',
  },
];

export function findPlaybook(slug: string) {
  return PLAYBOOK_ONLY.find((p) => p.slug === slug);
}

export const ALL_MODULES = VEHICLE_MODULES;

export function findModule(slug: string): NavModule | undefined {
  return VEHICLE_MODULES.find((x) => x.slug === slug);
}
