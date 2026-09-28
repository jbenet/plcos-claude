'use client';

import { useSyncExternalStore } from 'react';
import type { ImportJob } from './types';

/**
 * Import progress for the browser (issue 0114): one poll per tab, shared by the quiet status mark in
 * the rail and the full panel on Developer → Status and the pages that start imports. Every 2 s
 * while something runs, every 5 s when nothing does (GUESS: soon enough that a job started on
 * any page or tab shows within seconds; one small read, which the old panel made every 2 s). A job that finishes refreshes
 * the page, so what it changed shows without a reload.
 */
export type JobStatus = Pick<ImportJob, 'id' | 'kind' | 'status' | 'phase' | 'done' | 'total' | 'result' | 'error'> & {
  created_at?: string; finished_at?: string | null;
};
export interface JobsState { jobs: JobStatus[]; error: string | null; loaded: boolean }

const BUSY_MS = 2000, IDLE_MS = 5000;
let state: JobsState = { jobs: [], error: null, loaded: false };
const listeners = new Set<() => void>();
const finished = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let previous = new Map<string, string>();

const emit = () => { for (const l of listeners) l(); };
async function poll() {
  timer = null;
  try {
    const response = await fetch('/api/import-jobs', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const data = await response.json() as { jobs: JobStatus[] };
    const done = data.jobs.some((j) => previous.has(j.id) && previous.get(j.id) !== j.status && ['completed', 'failed'].includes(j.status));
    previous = new Map(data.jobs.map((j) => [j.id, j.status]));
    state = { jobs: data.jobs, error: null, loaded: true };
    emit();
    if (done) for (const f of finished) f();
  } catch {
    state = { ...state, error: 'Import progress is unavailable. Retrying; no import has been restarted.', loaded: true };
    emit();
  }
  if (listeners.size) timer = setTimeout(poll, state.jobs.some(active) ? BUSY_MS : IDLE_MS);
}
function subscribe(l: () => void) {
  listeners.add(l);
  if (!timer && listeners.size === 1) void poll();
  return () => {
    listeners.delete(l);
    if (!listeners.size && timer) { clearTimeout(timer); timer = null; }
  };
}
/** Poll now, as when an import has just been queued from this page. */
export function pollJobsNow() { if (timer) clearTimeout(timer); void poll(); }
/** Told when a job completes or stops, once per change. */
export function onJobFinished(f: () => void) { finished.add(f); return () => { finished.delete(f); }; }

const server: JobsState = { jobs: [], error: null, loaded: false };
export const useJobs = (): JobsState => useSyncExternalStore(subscribe, () => state, () => server);

export const active = (j: JobStatus) => j.status === 'queued' || j.status === 'running';
/**
 * A stopped job needs a look only while it is the latest of its kind: a later run of the same
 * import, finished or going, has already answered it (the live banner kept four stopped retries
 * of one merge on every page for a day).
 */
export function needsLook(jobs: JobStatus[]): JobStatus[] {
  const latest = new Map<string, JobStatus>();
  for (const j of jobs) if (!latest.has(j.kind)) latest.set(j.kind, j);
  return [...latest.values()].filter((j) => j.status === 'failed');
}
