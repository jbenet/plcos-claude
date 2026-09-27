import { resolve } from 'node:path';
// Process-local only. Other writers are observed by the background generation poll.
const state = globalThis as typeof globalThis & { __capitalOsActivityListeners?: Map<string, Set<() => void>> };
const listeners = state.__capitalOsActivityListeners ??= new Map();
export function onActivityChange(root: string, callback: () => void): () => void {
  const key = resolve(root);
  const group = listeners.get(key) ?? new Set();
  listeners.set(key, group); group.add(callback);
  return () => { group.delete(callback); if (!group.size && listeners.get(key) === group) listeners.delete(key); };
}
export function notifyActivityChange(root: string): void {
  for (const callback of listeners.get(resolve(root)) ?? []) callback();
}
