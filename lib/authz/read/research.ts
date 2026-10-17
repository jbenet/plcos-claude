import { currentUser } from '@/lib/auth';
import * as raw from '@/modules/research';
import { licensedAccess } from './r3';

/** Licensed (Dakota) by name or origin, as every other reader matches it: `dakota:…` ids, a dakota.com origin (red team, 17 Oct 2026). */
const LICENSED = /dakota/i, LICENSED_ID = /^dakota/i;
export * from '@/modules/research';
export async function claimsFor(...args: Parameters<typeof raw.claimsFor>) {
  const [user, claims] = await Promise.all([currentUser(), raw.claimsFor(...args)]);
  return licensedAccess(user) ? claims : claims.filter(c => !LICENSED_ID.test(c.provenance.source));
}
export async function notesFor(...args: Parameters<typeof raw.notesFor>) {
  const [user, notes] = await Promise.all([currentUser(), raw.notesFor(...args)]);
  return licensedAccess(user) ? notes : notes.filter(n => !LICENSED_ID.test(String(n.data.source ?? '')));
}
export async function listSourceDocs(...args: Parameters<typeof raw.listSourceDocs>) {
  const [user, docs] = await Promise.all([currentUser(), raw.listSourceDocs(...args)]);
  return licensedAccess(user) ? docs : docs.filter(d => !LICENSED.test(d.origin ?? '') && !LICENSED_ID.test(d.docId));
}
export async function sourceDocPage(offset: number, limit: number) {
  const user = await currentUser();
  return raw.sourceDocPage(offset, limit, licensedAccess(user) ? null : 'dakota');
}
export async function getSourceDoc(...args: Parameters<typeof raw.getSourceDoc>) {
  const [user, doc] = await Promise.all([currentUser(), raw.getSourceDoc(...args)]);
  return !licensedAccess(user) && doc && (LICENSED.test(doc.origin ?? '') || LICENSED_ID.test(doc.docId)) ? null : doc;
}
