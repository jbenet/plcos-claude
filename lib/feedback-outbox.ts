/**
 * The feedback outbox: reports kept in this browser until the server confirms an issue number
 * (Juan, 27 Sep: "can't submit feedback" while an import pegged the server or it restarted).
 *
 * File puts the report here and returns; nothing waits on the server. A sender posts each entry
 * with a short timeout and backs off (lib/feedback-journal.ts), and tries again at once when the
 * page loads, the network comes back, the tab is shown again, or any request to this app succeeds.
 * An entry leaves only when the server names the issue it filed; a resend of one that did reach the
 * server is answered with that same issue (the route dedupes on the client id).
 *
 * Storage: IndexedDB, one record per report, pictures and all. When IndexedDB is unavailable or
 * hangs (older Safari can leave `open` pending forever), the words go to localStorage without the
 * pictures and the entry says so. Every access is allowed to fail; a failed bookkeeping write only
 * means a report may be sent once more, which the server answers with the issue it already filed.
 *
 * Client only.
 */
import {
  SEND_TIMEOUT_MS, classify, due, entryTitle, settle,
  type ConnectionNoteRequest, type FeedbackRequest, type JournalEntry, type SendOutcome,
} from './feedback-journal';
import { newRequestKey } from './request-key';

const DB_NAME = 'capitalos-outbox';
const STORE = 'entries';
const LS_KEY = 'capitalos.feedback.outbox';
/** GUESS: a working IndexedDB opens in milliseconds; past this it is treated as unavailable. */
const OPEN_TIMEOUT_MS = 2_000;
/** A kick (a live request, the tab shown again) does not resend an entry tried this recently. */
const KICK_GAP_MS = 3_000;
/** How long a filed report's number stays on show. */
const FILED_SHOWN_MS = 8_000;

/** Filed a moment ago: an issue number, or (id null) a connection note saved. */
export interface FiledNote { clientId: string; id: string | null; title: string; at: number }

export interface OutboxState {
  entries: JournalEntry[];
  /** Client ids being sent right now. */
  sending: string[];
  /** Filed in the last few seconds, newest last. */
  filed: FiledNote[];
  /** The report just saved from the box, until its first send ends. */
  justSaved: string | null;
}

const EMPTY: OutboxState = { entries: [], sending: [], filed: [], justSaved: null };
let state: OutboxState = EMPTY;
const listeners = new Set<() => void>();
const set = (patch: Partial<OutboxState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const snapshot = () => state;
export const serverSnapshot = () => EMPTY;

// ---------------------------------------------------------------- storage

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error('IndexedDB did not open')); }, OPEN_TIMEOUT_MS);
    try {
      const req = window.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'clientId' }); };
      req.onsuccess = () => {
        clearTimeout(timer);
        if (settled) { req.result.close(); return; }
        settled = true;
        resolve(req.result);
      };
      req.onerror = () => { clearTimeout(timer); if (!settled) { settled = true; reject(req.error); } };
      req.onblocked = () => { clearTimeout(timer); if (!settled) { settled = true; reject(new Error('IndexedDB is blocked')); } };
    } catch (err) {
      clearTimeout(timer);
      settled = true;
      reject(err);
    }
  });
}

/**
 * One transaction, opened and closed each time: a connection held across a long background
 * stretch is what Safari drops ("Connection to Indexed Database server lost"). The work is plain
 * callbacks, not promises, so the transaction stays active between a read and the write after it
 * on every engine. It resolves when the transaction commits, with whatever `keep` was given.
 */
async function transact<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore, keep: (v: T) => void) => void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let out: T | undefined;
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      act(tx.objectStore(STORE), (v) => { out = v; });
    });
  } finally {
    db.close();
  }
}

function readLocal(): JournalEntry[] {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const list = raw ? (JSON.parse(raw) as JournalEntry[]) : [];
    return Array.isArray(list) ? list.filter((e) => e && typeof e.clientId === 'string' && e.request) : [];
  } catch { return []; }
}
function writeLocal(list: JournalEntry[]) {
  if (list.length) window.localStorage.setItem(LS_KEY, JSON.stringify(list));
  else window.localStorage.removeItem(LS_KEY);
}

// One storage operation at a time, so a late bookkeeping write cannot overtake a removal.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work);
  queue = result.catch(() => undefined);
  return result;
}

const storage = {
  all: () => serial(async () => {
    let kept: JournalEntry[] = [];
    try {
      kept = (await transact<JournalEntry[]>('readonly', (s, keep) => {
        const all = s.getAll();
        all.onsuccess = () => keep(all.result as JournalEntry[]);
      })) ?? [];
    } catch { /* none readable */ }
    const seen = new Set(kept.map((e) => e.clientId));
    return [...kept, ...readLocal().filter((e) => !seen.has(e.clientId))]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }),
  /** Keeps a new entry, or throws when there is nowhere to keep it. */
  add: (entry: JournalEntry) => serial(async () => {
    try {
      await transact('readwrite', (s) => { s.put(entry); });
      return entry;
    } catch {
      const words: JournalEntry = entry.target === 'connection'
        ? { ...entry, textOnly: true }
        : { ...entry, textOnly: true, request: { ...entry.request, screenshots: [], images: [] } };
      writeLocal([...readLocal().filter((e) => e.clientId !== entry.clientId), words]);
      return words;
    }
  }),
  /** Changes an entry that is still there; one another tab has filed is not brought back. */
  update: (clientId: string, change: (e: JournalEntry) => JournalEntry) => serial(async () => {
    try {
      await transact('readwrite', (s) => {
        const got = s.get(clientId);
        got.onsuccess = () => { if (got.result) s.put(change(got.result as JournalEntry)); };
      });
    } catch { /* bookkeeping only */ }
    try {
      const local = readLocal();
      if (local.some((e) => e.clientId === clientId)) writeLocal(local.map((e) => (e.clientId === clientId ? change(e) : e)));
    } catch { /* bookkeeping only */ }
  }),
  remove: (clientId: string) => serial(async () => {
    try { await transact('readwrite', (s) => { s.delete(clientId); }); } catch { /* sent again, answered with the same issue */ }
    try { writeLocal(readLocal().filter((e) => e.clientId !== clientId)); } catch { /* likewise */ }
  }),
};

// ---------------------------------------------------------------- tabs

let channel: BroadcastChannel | null = null;
const tellOtherTabs = () => { try { channel?.postMessage('changed'); } catch { /* one tab */ } };

async function refresh() {
  const entries = await storage.all();
  set({ entries, justSaved: state.justSaved && entries.some((e) => e.clientId === state.justSaved) ? state.justSaved : null });
  return entries;
}

// ---------------------------------------------------------------- the sender

/** The page's own fetch, before the success hook below wraps it: the sender's sends are not kicks. */
let plainFetch: typeof fetch | null = null;
const lastTried = new Map<string, number>();
let pumping = false;
let again: boolean | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function sendOne(entry: JournalEntry): Promise<SendOutcome> {
  const ctrl = new AbortController();
  const stop = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
  try {
    // Each route takes the client id under its own name; both answer a resend with what they kept.
    const [url, payload] = entry.target === 'connection'
      ? ['/api/connection-feedback', { ...entry.request, id: entry.clientId }]
      : ['/api/feedback', { ...entry.request, clientId: entry.clientId }];
    const res = await (plainFetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { /* an HTML error page, or cut off */ }
    return classify(entry.clientId, res.status, json, undefined, entry.target ?? 'issue');
  } catch {
    return classify(entry.clientId, null, null, ctrl.signal.aborted
      ? `No answer within ${SEND_TIMEOUT_MS / 1000} s`
      : 'Could not reach the server', entry.target ?? 'issue');
  } finally {
    clearTimeout(stop);
  }
}

async function attempt(entry: JournalEntry) {
  lastTried.set(entry.clientId, Date.now());
  set({ sending: [...state.sending, entry.clientId] });
  const outcome = await sendOne(entry);
  if (outcome.kind === 'filed') {
    await storage.remove(entry.clientId);
    const note: FiledNote = { clientId: entry.clientId, id: outcome.id, title: entryTitle(entry), at: Date.now() };
    set({ filed: [...state.filed, note] });
    setTimeout(() => set({ filed: state.filed.filter((f) => f !== note) }), FILED_SHOWN_MS);
  } else {
    const now = Date.now();
    await storage.update(entry.clientId, (e) => settle([e], e.clientId, outcome, now)[0]!);
  }
  set({
    sending: state.sending.filter((id) => id !== entry.clientId),
    justSaved: state.justSaved === entry.clientId ? null : state.justSaved,
  });
  tellOtherTabs();
  await refresh();
}

/** Send what is due; `kicked` sends every entry that is not refused and not tried a moment ago. */
async function pump(kicked: boolean) {
  if (pumping) { again = Boolean(again) || kicked; return; }
  pumping = true;
  try {
    let kick = kicked;
    for (;;) {
      again = null;
      const entries = await refresh();
      const now = Date.now();
      for (const e of entries) {
        if (state.sending.includes(e.clientId) || !due(e, now, kick)) continue;
        if (kick && e.nextAt > now && now - (lastTried.get(e.clientId) ?? 0) < KICK_GAP_MS) continue;
        await attempt(e);
      }
      if (again === null) break;
      kick = again;
    }
  } catch { /* the next kick or tick tries again */ } finally {
    pumping = false;
    schedule();
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  const waiting = state.entries.filter((e) => !e.refused);
  if (!waiting.length) return;
  const next = Math.min(...waiting.map((e) => e.nextAt));
  timer = setTimeout(() => void pump(false), Math.max(1_000, next - Date.now()));
}

let lastKick = 0;
function kick() {
  lastKick = Date.now();
  void pump(true);
}

let started = false;
/** Starts the sender once per page. Safe to call from every component that files. */
export function startOutbox() {
  if (started || typeof window === 'undefined') return;
  started = true;
  plainFetch = window.fetch.bind(window);
  try {
    channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(DB_NAME) : null;
    if (channel) channel.onmessage = () => { void refresh().then(schedule); };
  } catch { channel = null; }
  window.addEventListener('storage', (e) => { if (e.key === LS_KEY) void refresh().then(schedule); });
  window.addEventListener('online', kick);
  window.addEventListener('pageshow', (e) => { if (e.persisted) kick(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  // Any request to this app that succeeds says the server is answering again. Wrapped once, and
  // only watched: the request and its response pass through untouched.
  const w = window as typeof window & { __capitalosOutboxFetch?: boolean };
  if (!w.__capitalosOutboxFetch) {
    w.__capitalosOutboxFetch = true;
    const original = window.fetch;
    window.fetch = async function watched(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const res = await original.call(this ?? window, input, init);
      try {
        if (res.ok && state.entries.some((e) => !e.refused) && Date.now() - lastKick > KICK_GAP_MS
          && new URL(res.url || String(input), window.location.href).origin === window.location.origin) kick();
      } catch { /* only watched */ }
      return res;
    } as typeof fetch;
  }
  kick();
}

// ---------------------------------------------------------------- what the page calls

const fresh = () => ({
  clientId: newRequestKey(),
  createdAt: new Date().toISOString(),
  attempts: 0,
  nextAt: 0,
  lastError: null,
  refused: false,
});

/** Keep one report and start sending it. Throws only when this browser can keep nothing. */
export const enqueue = (req: FeedbackRequest) => keep({ ...fresh(), request: req });

/** Keep one connection note and start sending it (components/routes/ConnectionFeedback.tsx). */
export const enqueueConnectionNote = (req: ConnectionNoteRequest) => keep({ ...fresh(), target: 'connection', request: req });

async function keep(entry: JournalEntry): Promise<JournalEntry> {
  startOutbox();
  const kept = await storage.add(entry);
  set({ entries: [...state.entries.filter((e) => e.clientId !== kept.clientId), kept], justSaved: kept.clientId });
  tellOtherTabs();
  void pump(true);
  return kept;
}

/** Send this one now, even one the server refused. */
export async function retryNow(clientId: string) {
  lastTried.delete(clientId);
  await storage.update(clientId, (e) => ({ ...e, refused: false, nextAt: 0 }));
  tellOtherTabs();
  await pump(true);
}

/** Drop a report that will not be filed. The caller confirms first. */
export async function discardEntry(clientId: string) {
  await storage.remove(clientId);
  tellOtherTabs();
  await refresh();
  schedule();
}
