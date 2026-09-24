/**
 * Unsent feedback, kept in this browser (issues 0018 and 0026, real). A draft is named by the page it
 * was started on. Its words — title, text, kind, priority — go to localStorage, one key per draft,
 * `capitalos.feedback.draft:<page>`. Its pictures — the screenshots, drawn on or not, and any image
 * dropped into the text — go to IndexedDB under the same page, because two or three of them are more
 * than localStorage holds. Nothing here leaves the browser until the report is filed.
 *
 * Client only. Every read and write is allowed to fail — a private window, storage turned off — and
 * a failure means the draft is not kept, never that the box breaks.
 */

export const DRAFT_PREFIX = 'capitalos.feedback.draft:';

export interface DraftWords {
  title: string;
  body: string;
  kind?: string;
  priority?: string;
  /** When it was last saved. */
  at?: string;
  /** How many pictures were kept with it, in IndexedDB. */
  pictures?: number;
}

export interface DraftSummary {
  page: string;
  title: string;
  at: string | null;
  pictures: number;
}

export interface DraftPictures<Shot, Image> {
  shots: Shot[];
  images: Image[];
}

export function readDraft(page: string): DraftWords | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_PREFIX + page);
    if (!raw) return null;
    const d = JSON.parse(raw) as DraftWords;
    return typeof d === 'object' && d ? { title: d.title ?? '', body: d.body ?? '', kind: d.kind, priority: d.priority, at: d.at, pictures: d.pictures ?? 0 } : null;
  } catch { return null; }
}

export function writeDraft(page: string, words: DraftWords | null): void {
  try {
    if (words) window.localStorage.setItem(DRAFT_PREFIX + page, JSON.stringify(words));
    else window.localStorage.removeItem(DRAFT_PREFIX + page);
  } catch { /* not kept */ }
}

/** Every draft in this browser, the latest first. */
export function listDrafts(): DraftSummary[] {
  const out: DraftSummary[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(DRAFT_PREFIX)) continue;
      const page = key.slice(DRAFT_PREFIX.length);
      const d = readDraft(page);
      if (!d) continue;
      const firstLine = d.body.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) ?? '';
      out.push({ page, title: d.title.trim() || firstLine || 'No words yet', at: d.at ?? null, pictures: d.pictures ?? 0 });
    }
  } catch { /* nothing to list */ }
  return out.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
}

const DB_NAME = 'capitalos-feedback';
const STORE = 'pictures';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = act(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function readPictures<Shot, Image>(page: string): Promise<DraftPictures<Shot, Image> | null> {
  try {
    const got = await run<DraftPictures<Shot, Image> | undefined>('readonly', (s) => s.get(page));
    return got && Array.isArray(got.shots) && Array.isArray(got.images) ? got : null;
  } catch { return null; }
}

/** True when they were kept. */
export async function writePictures<Shot, Image>(page: string, pictures: DraftPictures<Shot, Image> | null): Promise<boolean> {
  try {
    if (pictures && (pictures.shots.length || pictures.images.length)) await run('readwrite', (s) => s.put(pictures, page));
    else await run('readwrite', (s) => s.delete(page));
    return true;
  } catch { return false; }
}

export async function discardDraft(page: string): Promise<void> {
  writeDraft(page, null);
  await writePictures(page, null);
}
