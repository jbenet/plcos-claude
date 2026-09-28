/**
 * Linear, as the pages show it (docs/24-linear.md): issues and projects read from our replica,
 * never from Linear. Every row links out to Linear, which stays the place to change anything.
 */

/** Linear's workflow state types. */
export type StateType = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' | 'duplicate' | 'unknown';
/** Linear's project status types. */
export type ProjectStatusType = 'backlog' | 'planned' | 'started' | 'paused' | 'completed' | 'canceled' | 'unknown';

export const OPEN_TYPES: StateType[] = ['triage', 'backlog', 'unstarted', 'started'];
/** The order Linear lists status groups in: work under way first, closed work last. */
export const STATE_ORDER: StateType[] = ['triage', 'started', 'unstarted', 'backlog', 'completed', 'canceled', 'duplicate', 'unknown'];

/** Linear's priority numbers: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export const PRIORITY_LABEL = ['No priority', 'Urgent', 'High', 'Medium', 'Low'] as const;
/** Sort key: urgent first, no priority last, as Linear sorts. */
export const priorityRank = (p: number) => (p >= 1 && p <= 4 ? p : 5);

export interface Person {
  name: string;
  initials: string;
  /** Matched to someone on our team, by email or linearEmail. */
  ours: boolean;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string | null;
  priority: number;
  /** YYYY-MM-DD */
  dueDate: string | null;
  state: { name: string; type: StateType; position: number };
  labels: Array<{ name: string; color: string | null }>;
  project: { id: string; name: string; color: string | null } | null;
  assignee: Person | null;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface IssueGroup {
  key: string;
  title: string;
  /** Drawn with the header: a state's icon, or an assignee's avatar. */
  icon: { kind: 'state'; type: StateType } | { kind: 'person'; person: Person | null } | { kind: 'due' };
  issues: LinearIssue[];
  /** Issues left out of the list, counted. */
  more?: number;
}

export interface Freshness {
  status: 'ok' | 'stale' | 'failed' | 'not_connected' | 'never';
  lastSyncAt: Date | null;
}

export interface MyLinear {
  freshness: Freshness;
  /** The Linear members the signed-in person is matched to. Empty when unmatched. */
  matched: Array<{ name: string; email: string }>;
  mine: IssueGroup[];
  backlog: number;
  team: IssueGroup[];
  teamCount: number;
  /** Links out to Linear's own views, derived from an issue's address. */
  links: { mine: string | null; team: string | null };
  /** Whether the replica holds any issue at all. */
  synced: boolean;
}

export interface Workstream {
  id: string;
  name: string;
  url: string | null;
  color: string | null;
  status: { name: string; type: ProjectStatusType };
  lead: Person | null;
  start: string | null;
  target: string | null;
  total: number;
  done: number;
  open: number;
  health: string | null;
}

export interface Workstreams {
  freshness: Freshness;
  projects: Workstream[];
  upcoming: LinearIssue[];
  upcomingMore: number;
  recentlyDone: LinearIssue[];
  /** Projects that look like this vehicle by name and wait for a person to accept them. */
  suggested: number;
  synced: boolean;
}

export interface LinkReviewVehicle {
  id: string;
  slug: string;
  name: string;
  terms: string[];
  linked: Array<{ projectId: string; name: string; statusName: string | null; by: string | null; asOf: Date; source: 'name' | 'person'; basis: string | null }>;
  suggested: Array<{ projectId: string; name: string; statusName: string | null; basis: string }>;
  rejected: Array<{ projectId: string; name: string }>;
  /** Every other project, for linking by hand. */
  others: Array<{ projectId: string; name: string }>;
}
