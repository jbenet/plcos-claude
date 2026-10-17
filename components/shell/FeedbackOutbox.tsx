'use client';

import { useSyncExternalStore } from 'react';
import { serverSnapshot, snapshot, subscribe, type OutboxState } from '@/lib/feedback-outbox';

export const useOutbox = (): OutboxState => useSyncExternalStore(subscribe, snapshot, serverSnapshot);

const plural = (n: number) => (n === 1 ? '1 note' : `${n} notes`);

/**
 * Where filed feedback stands (Juan, 27 Sep), so he knows when it is safe to close the tab. Since
 * issue 0114 it is said by the one status mark beside the user (components/shell/SystemStatus.tsx),
 * which also carries the imports; a tap there opens the words, and "Show the notes" opens the list
 * (OutboxList.tsx): each report's state, Retry now and Copy text. "Only on this device" outranks everything,
 * because it is the one state that is not yet safe.
 */
export type OutboxTone = 'device' | 'send' | 'server' | 'done' | 'refused';
/**
 * Where filed feedback stands, in words: `label` in full, `short` for a narrow line, and a tone.
 * Null when there is nothing to say. Shared with the rail's status mark (issue 0114).
 */
export function outboxSummary(out: OutboxState): { label: string; short: string; tone: OutboxTone } | null {
  const device = out.entries.filter((e) => !(out.justSaved === e.clientId && out.sending.includes(e.clientId)));
  const saving = out.entries.length - device.length;
  const server = out.onServer.length;
  const latest = out.filed.at(-1);
  if (!out.entries.length && !server && !latest) return null;

  let label: string;
  let short: string;
  let tone: OutboxTone;
  if (device.length) {
    const refused = device.filter((e) => e.refused).length;
    label = `${plural(device.length)} only on this device${refused ? ` · ${refused} refused` : ''}${server ? ` · ${server} on the server` : ''}`;
    short = `${device.length} on this device`;
    tone = refused ? 'refused' : 'device';
  } else if (saving) {
    label = 'Saving…'; short = 'Saving…'; tone = 'send';
  } else if (server) {
    label = server === 1 ? 'Saved on server · filing…' : `${server} saved on server · filing…`;
    short = 'On the server';
    tone = 'server';
  } else if (latest!.error) {
    label = `Not filed: ${latest!.error}`; short = 'Not filed'; tone = 'refused';
  } else {
    label = latest!.id ? `Filed as issue ${latest!.id}` : 'Connection note saved';
    short = latest!.id ? `Filed ${latest!.id}` : 'Saved';
    tone = 'done';
  }

  return { label, short, tone };
}
