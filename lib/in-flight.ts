export interface RenderContext {
  cookies: string;
  vehicle: string | null;
  host: string | null;
  askedPath: string | null;
}

/** Only explicit data inputs belong here; never serialize React children into a key. */
export function renderKey(route: string, inputs: unknown, context: RenderContext): string {
  return JSON.stringify([route, inputs, context], (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}

/** Coalesce running work only. Never retain a completed page or evict an active job. */
export function singleFlight() {
  const pending = new Map<string, Promise<unknown>>();
  return <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const prior = pending.get(key);
    if (prior) return prior as Promise<T>;
    const job = Promise.resolve().then(load);
    pending.set(key, job);
    const clear = () => { if (pending.get(key) === job) pending.delete(key); };
    void job.then(clear, clear);
    return job;
  };
}
