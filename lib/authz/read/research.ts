import { currentUser } from '@/lib/auth';
import * as raw from '@/modules/research';
import { licensedAccess } from './r3';
export * from '@/modules/research';
export async function claimsFor(...args: Parameters<typeof raw.claimsFor>) {
  const [user, claims] = await Promise.all([currentUser(), raw.claimsFor(...args)]);
  return licensedAccess(user) ? claims : claims.filter(c => c.provenance.source !== 'dakota');
}
export async function notesFor(...args: Parameters<typeof raw.notesFor>) {
  const [user, notes] = await Promise.all([currentUser(), raw.notesFor(...args)]);
  return licensedAccess(user) ? notes : notes.filter(n => n.data.source !== 'dakota');
}
export async function listSourceDocs(...args: Parameters<typeof raw.listSourceDocs>) {
  const [user, docs] = await Promise.all([currentUser(), raw.listSourceDocs(...args)]);
  return licensedAccess(user) ? docs : docs.filter(d => d.origin !== 'dakota');
}
export async function getSourceDoc(...args: Parameters<typeof raw.getSourceDoc>) {
  const [user, doc] = await Promise.all([currentUser(), raw.getSourceDoc(...args)]);
  return !licensedAccess(user) && doc?.origin === 'dakota' ? null : doc;
}
