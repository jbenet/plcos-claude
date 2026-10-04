/**
 * Is the Keychain's mailguard token drafts-only? (docs/25 §12.5)   npm run mailguard:check
 *
 * One `GET /api/v1/me` at mailguard — a read that touches no mail and makes no draft — then the same
 * check the server runs. Prints the verdict, the reason's code and the mailbox's domain: never the
 * token, never the address. Exits 1 when the token is refused or cannot be checked.
 */
import { checkKeychainKey } from '../lib/connectors/mailguard';

const r = await checkKeychainKey();
console.log(r.ok
  ? `mailguard: the token is drafts-only, for a mailbox at ${r.domain}${r.canThread ? '' : '; it cannot read thread headers, so follow-ups start new threads'}${r.extras.length ? `; more than needed: ${r.extras.join(', ')}` : ''}.`
  : `mailguard: refused (${r.code})${r.domain ? `, a mailbox at ${r.domain}` : ''}: ${r.reason}`);
process.exit(r.ok ? 0 : 1);
