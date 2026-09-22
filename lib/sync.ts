import { listSyncSources, type SourceSync } from '@/modules/platform';
import { config } from '@/config/deployment';
import { ago } from './time';

/** Where rows came from that are not a connector: the demo's fixtures, the real profile's init file. */
const LOCAL = new Set(['seed', 'init']);

export interface SyncSummary {
  tone: 'ok' | 'amber' | 'grey' | 'clay';
  /** The sentence in the breadcrumb bar. Staleness is never rendered as freshness. */
  line: string;
  sources: SourceSync[];
}

export async function syncSummary(): Promise<SyncSummary> {
  const sources = await listSyncSources();
  if (sources.length === 0) {
    return { tone: 'grey', line: 'No sources registered', sources };
  }
  const failed = sources.filter((s) => s.status === 'failed');
  const stale = sources.filter((s) => s.status === 'stale');
  const connectors = sources.filter((s) => !LOCAL.has(s.source));
  const liveConnectors = connectors.filter((s) => s.status === 'ok');
  const newest = sources
    .map((s) => s.lastSyncAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  if (failed.length > 0) {
    return { tone: 'clay', line: `${failed[0]!.label} failed to sync${newest ? ` · last good read ${ago(newest)}` : ''}`, sources };
  }
  if (stale.length > 0) {
    return { tone: 'amber', line: `${stale.length} source${stale.length > 1 ? 's' : ''} stale${newest ? ` · read ${ago(newest)}` : ''}`, sources };
  }
  if (liveConnectors.length === 0) {
    if (config.data.profile === 'real') {
      const init = sources.find((s) => s.source === 'init');
      return {
        tone: 'grey',
        line: `Nothing imported yet${init?.lastSyncAt ? ` · init file loaded ${ago(init.lastSyncAt)}` : ' · init file not loaded'}`,
        sources,
      };
    }
    return {
      tone: 'grey',
      line: `Seed data · no connector attached${newest ? ` · loaded ${ago(newest)}` : ''}`,
      sources,
    };
  }
  return {
    tone: 'ok',
    line: `${liveConnectors.length} of ${connectors.length} connectors synced${newest ? ` · ${ago(newest)}` : ''}`,
    sources,
  };
}
