/**
 * Everything this tool may ask Linear (docs/24-linear.md). The client sends only these texts, by
 * name; anything else is refused before it leaves the machine. Adding one is a reviewed change: it
 * shows in a diff and on Developer → Linear.
 *
 * Fields are the ones the replica keeps and no more. Field names were checked against the live
 * schema by introspection (27 Sep 2026). Linear has no custom fields on issues; labels, label
 * groups, projects and milestones carry its structure. Customer requests are not enabled in the
 * workspace, so `customers` is not asked for.
 */

export const ENTITIES = ['teams', 'users', 'states', 'labels', 'projects', 'milestones', 'cycles', 'issues', 'comments'] as const;
export type Entity = (typeof ENTITIES)[number];

interface Spec {
  /** The GraphQL root field. */
  root: string;
  /** Its filter type, for the `updatedAt` filter on an incremental pull. */
  filter: string;
  fields: string;
  purpose: string;
}

const SPECS: Record<Entity, Spec> = {
  teams: { root: 'teams', filter: 'TeamFilter', fields: 'id key name createdAt updatedAt archivedAt',
    purpose: 'Teams: the top of Linear’s structure, and how issues divide between the raise and everything else.' },
  users: { root: 'users', filter: 'UserFilter', fields: 'id name displayName email active createdAt updatedAt archivedAt',
    purpose: 'Members referenced by allowed-team work, to tell our own team among assignees (matched by email).' },
  states: { root: 'workflowStates', filter: 'WorkflowStateFilter', fields: 'id name type position team { id } updatedAt archivedAt',
    purpose: 'Workflow states, so an issue reads as open, done or canceled by type rather than by name.' },
  labels: { root: 'issueLabels', filter: 'IssueLabelFilter', fields: 'id name color isGroup parent { id } team { id } updatedAt archivedAt',
    purpose: 'Issue labels and label groups, which are where Linear keeps structure, with the colour Linear shows them in.' },
  projects: { root: 'projects', filter: 'ProjectFilter',
    fields: 'id name description slugId url color status { name type } lead { id } startDate targetDate startedAt completedAt canceledAt createdAt updatedAt archivedAt teams(filter: { key: { in: $teamKeys } }) { nodes { id } } labelIds health priority',
    purpose: 'Projects with status, lead and dates: the workstreams, and the only place Linear holds a timeline.' },
  milestones: { root: 'projectMilestones', filter: 'ProjectMilestoneFilter', fields: 'id name targetDate project { id } sortOrder updatedAt archivedAt',
    purpose: 'Project milestones with target dates.' },
  cycles: { root: 'cycles', filter: 'CycleFilter', fields: 'id number name startsAt endsAt completedAt team { id } updatedAt archivedAt',
    purpose: 'Cycles (sprints), where a team uses them.' },
  issues: { root: 'issues', filter: 'IssueFilter',
    fields: 'id identifier title description url priority estimate dueDate createdAt updatedAt startedAt completedAt canceledAt archivedAt state { id } assignee { id } creator { id } team { id } project { id } projectMilestone { id } cycle { id } parent { id } labelIds',
    purpose: 'Issues: title, description, state, owner, priority, estimate, labels, project, cycle, dates and parent.' },
  comments: { root: 'comments', filter: 'CommentFilter', fields: 'id body issue { id } user { id } parent { id } createdAt updatedAt archivedAt',
    purpose: 'Comments on issues, for the latest word on a task.' },
};

/** Required scope is embedded in the reviewed query, separate from caller filters.
 * ProjectFilter uses accessibleTeams (not teams); checked against Linear’s published SDK schema:
 * https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql
 */
export const TEAM_FILTERS: Record<Entity, string> = {
  teams: 'key: { in: $teamKeys }',
  users: 'id: { in: $userIds }',
  states: 'team: { key: { in: $teamKeys } }',
  labels: 'team: { key: { in: $teamKeys } }',
  projects: 'accessibleTeams: { some: { key: { in: $teamKeys } } }',
  milestones: 'project: { accessibleTeams: { some: { key: { in: $teamKeys } } } }',
  cycles: 'team: { key: { in: $teamKeys } }',
  issues: 'team: { key: { in: $teamKeys } }',
  comments: 'issue: { team: { key: { in: $teamKeys } } }',
};

const pageQuery = (name: string, entity: Entity, s: Spec) =>
  `query ${name}($first: Int!, $after: String, $filter: ${s.filter}!, ${entity === 'users' ? '$userIds: [ID!]!' : '$teamKeys: [String!]!'}) { ${s.root}(first: $first, after: $after, filter: { and: [$filter, { ${TEAM_FILTERS[entity]} }] }, includeArchived: true) { nodes { ${s.fields} } pageInfo { hasNextPage endCursor } } }`;

export const opName = (e: Entity) => `Linear${e[0]!.toUpperCase()}${e.slice(1)}`;

/** The allowlist: operation name → the exact text sent. */
export const QUERIES: Readonly<Record<string, { text: string; entity: Entity | null; root: string | null; purpose: string }>> = Object.freeze({
  LinearTest: {
    text: 'query LinearTest($teamKeys: [String!]!) { teams(first: 50, filter: { key: { in: $teamKeys } }) { nodes { id } } }',
    entity: null, root: null,
    purpose: 'The connection test: that the key answers, and how many teams it can see. Counts only.',
  },
  ...Object.fromEntries(ENTITIES.map((e) => [opName(e), { text: pageQuery(opName(e), e, SPECS[e]), entity: e, root: SPECS[e].root, purpose: SPECS[e].purpose }])),
});

export type QueryName = keyof typeof QUERIES & string;
