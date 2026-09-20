/**
 * The navigation model: four umbrella sections, not twenty-four flat items.
 *
 * Each module carries the stage it lands at. Until it lands, the rail shows the stage
 * rather than a fake count — the rail doubles as the build sequence, and clicking an
 * unbuilt module explains what it will do instead of 404ing.
 */

export type Stage = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8' | 'L9' | 'L10' | 'L11' | 'L12' | 'L13';

export interface NavModule {
  num: string;
  title: string;
  slug: string;
  href: string;
  stage: Stage;
  built: boolean;
  /** One line, shown on the placeholder page and in the rail title attribute. */
  mechanic: string;
}

export interface NavSection {
  title: string;
  range: string;
  modules: NavModule[];
}

const m = (
  num: string, title: string, slug: string, stage: Stage, mechanic: string, built = false,
): NavModule => ({ num, title, slug, stage, mechanic, built, href: built ? `/${slug}` : `/m/${slug}` });

export const SECTIONS: NavSection[] = [
  {
    title: 'Discover & qualify',
    range: '01–06',
    modules: [
      m('01', 'Research & enrichment', 'research', 'L2', 'Universe assembly; provenance tuple on every field; refusal to claim without one.', true),
      m('03', 'Selection', 'selection', 'L9', 'The capacity/affinity/propensity rubric, with weights visible and editable.', true),
      m('04', 'Conversion strategy', 'targets', 'L5', 'The per-target workspace; consent ladder; coverage disclosure.', true),
      m('05', 'Warm intro routes', 'routes', 'L4', 'Route ranking by connector credibility; A–D evidence tiers, human review on C and D; non-circumvention.', true),
    ],
  },
  {
    title: 'Convert & coordinate',
    range: '07–12',
    modules: [
      m('07', 'Ask coordination', 'asks', 'L3', 'One owner per relationship; frequency guard; ConflictCase with a dated follow-up for the loser.', true),
      m('08', 'Soft → Hard', 'soft-hard', 'L6', 'Two separate tracks. Convertible soft is shown and never added to hard.', true),
      m('09', 'Vehicle status', 'vehicles', 'L6', 'Per-vehicle pipeline, velocity, and how the bottleneck moved.', true),
      m('10', 'Decision room', 'decisions', 'L11', 'Diligence questions, objections, conditions, evidence, decision timeline.', true),
      m('11', 'Meetings', 'meetings', 'L11', 'Prep brief, objection tagging, and the consent-ladder step a reply actually justifies.', true),
    ],
  },
  {
    title: 'Create & substantiate',
    range: '13–17',
    modules: [
      m('14', 'Content studio', 'content', 'L12', 'Canonical asset plus audience variants; a changed claim invalidates its derivatives.', true),
      m('15', 'Content performance', 'performance', 'L12', 'Attribution honest about its limits. Views are not commitment, and the UI says so.', true),
      m('16', 'Materials & send gate', 'materials', 'L12', 'SEND approval ticket; wrong-wrap matrix; staleness. Wrong-wrap sends = 0 is a hard KPI.', true),
      m('17', 'Answer library', 'library', 'L12', 'Approved answers with their own versioning and approval state, plus the coverage-gap backlog.', true),
    ],
  },
  {
    title: 'Execute & govern',
    range: '18–24',
    modules: [
      m('18', 'Close room', 'close', 'L8', 'Fund-cycle close: subscription pack, conditions, committee clock.', true),
      m('19', 'SPV war room', 'spv', 'L8', 'invite → IOI → allocate → wire, with days-to-wire as the headline.', true),
      m('20', 'Grants rail', 'grants', 'L13', 'No-unsolicited gate until a funder invitation exists. A state machine guard, not advice.', true),
      m('21', 'Forecast', 'forecast', 'L6', 'Conserved capital pool invariant; hard-only headline; code does the arithmetic.', true),
      m('22', 'Sprint calendar', 'calendar', 'L7', 'Holiday overlay; the post-23-December dead zone suppresses urgency.', true),
      m('24', 'Compliance registry', 'compliance', 'L13', 'Accreditation verification, the public-claims registry, the solicitation log and side-letter risk.', true),
    ],
  },
];

/** Modules that start as a playbook against the shared workspace rather than a screen. */
export const PLAYBOOK_ONLY = [
  { num: '02', title: 'Segmentation', why: 'Rule-built audiences from explicit criteria. Earns a screen when a rule set needs editing more than once a week.' },
  { num: '06', title: 'Signals', why: 'Fixture-driven until connectors exist at L13. A screen before then would render invented change detection.' },
  { num: '12', title: 'LP-fit audit', why: 'An output format over the target workspace, not a place to visit.' },
  { num: '23', title: 'Team capacity', why: 'Role × vehicle slots. One person does not need a screen for this yet.' },
];

export const ALL_MODULES: NavModule[] = SECTIONS.flatMap((s) => s.modules);

export function findModule(slug: string): NavModule | undefined {
  return ALL_MODULES.find((x) => x.slug === slug);
}

export function sectionOf(slug: string): NavSection | undefined {
  return SECTIONS.find((s) => s.modules.some((x) => x.slug === slug));
}
