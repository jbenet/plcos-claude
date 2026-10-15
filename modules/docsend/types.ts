/** One DocSend visit as the conversion page reads it (docs/32-docsend.md §3, §6). */
export interface DocsendVisit {
  visitId: string;
  source: 'mcp';
  startedAt: Date;
  durationSec: number | null;
  pagesViewed: number | null;
  pageCount: number | null;
  percentViewed: number | null;
  /** Seconds on each page, by page number. */
  pageSeconds: Record<string, number> | null;
  viewerEmail: string | null;
  /** The LP's canonical entity, matched by email; null when no one on record has the address. */
  entityId: string | null;
  /** DocSend's MCP gives a link's name, never its id. */
  linkId: null;
  linkName: string | null;
  documentId: string | null;
  documentTitle: string | null;
  spaceId: string | null;
  spaceName: string | null;
  vehicleId: string;
}

export interface VisitsFor { visits: DocsendVisit[]; asOf: Date | null }

/** A visit as the sync writes it. */
export interface VisitRow {
  visitId: string;
  startedAt: Date;
  durationSec: number | null;
  pagesViewed: number | null;
  pageCount: number | null;
  percentViewed: number | null;
  pageSeconds: Record<string, number> | null;
  viewerEmail: string | null;
  viewerName: string | null;
  linkName: string | null;
  documentId: number | null;
  documentTitle: string | null;
  spaceId: number | null;
  spaceName: string | null;
  raw: unknown;
}

export interface DocsendConnection { userId: string; userName: string | null; connectedAt: Date; lastError: string | null; lastErrorAt: Date | null }

export interface DocsendSpace { spaceId: number; name: string; readAt: Date | null; vehicleId: string | null; vehicleName: string | null; visits: number; viewers: number }
