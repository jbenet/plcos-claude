/**
 * A person's addresses (migration 019; Juan, 5 Oct 2026), on invented data and a fake Google:
 *   - app_user.email stays equal to the default-to address, from either side;
 *   - an address belongs to one person: the database, Settings → People and the init file refuse a second owner;
 *   - the init file sets an exact address set, and a clash is reported with nothing applied;
 *   - Google sign-in admits a person by any of their addresses (through the real route handlers);
 *   - mail matching (the comms team map, Affinity email evidence) finds the person by an alias;
 *   - the People page's address edits are audited, and refused under the Mac's user switcher.
 */
import { workAsyncStorage, type WorkStore } from 'next/dist/server/app-render/work-async-storage.external';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { createRequestStore } from 'next/dist/server/async-storage/request-store';
import { actionAsyncStorage } from 'next/dist/server/app-render/action-async-storage.external';
import { config } from '../../config/deployment';
import { withDb } from '../../lib/db';
import { USER_COOKIE } from '../../lib/auth/cookie';
import { sessionCookie, sessionValue, userFromSession } from '../../lib/auth/session';
import { forgetRootSecret } from '../../lib/settings/key';
import { checkSettings, forgetSettings, loadSettings, writeSettings } from '../../lib/settings/store';
import { fakeConsent, useFakeGoogle } from '../../lib/connectors/google-signin/signin';
import { teamAddresses } from '../../lib/comms/read';
import { emailTeamResolver } from '../../lib/enrich/email-evidence';
import { applyTeam, validate as validateInit, type TeamMember } from '../../lib/real/init';
import { activeUsersByEmail, addressesOf } from '../../modules/platform';
import type { Check, Db } from './harness';

const ORIGIN = 'http://localhost:3113';
const PUBLIC = 'https://raise.example.test';
const CLIENT_ID = 'invented-alias-0042.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-invented-alias-secret';

const inRequest = <T>(db: Db, cookie: string, pathname: string, work: () => Promise<T>) =>
  withDb(db, () => workAsyncStorage.run({ route: pathname, isStaticGeneration: false, incrementalCache: {}, pendingRevalidatedTags: [] } as unknown as WorkStore,
    () => workUnitAsyncStorage.run(createRequestStore({
      phase: 'action', headers: new Headers({ host: 'localhost:3113', origin: ORIGIN, 'sec-fetch-site': 'same-origin', cookie }),
      url: { pathname }, rootParams: {}, implicitTags: { tags: [], expirationsByCacheKind: new Map() }, resumeDataCache: null,
      onUpdateCookies: undefined, previewProps: undefined, isHmrRefresh: false, serverComponentsHmrCache: undefined, hmrRefreshHash: undefined, fallbackParams: null,
    }), () => actionAsyncStorage.run({ isAction: true }, work))));

export async function teamAddressProperties(check: Check, db: Db) {
  const savedProvider = config.auth.provider;
  const savedSecret = process.env.PLCOS_SECRET;
  const handles = ['addr-props-ana', 'addr-props-ben', 'addr-props-cy'];
  const user = async (handle: string, email: string, access = 'gp') => (await db.one<{ id: string }>(`insert into platform.app_user (handle, name, initials, role, email, access)
    values ($1, $2, 'IA', 'Invented (props)', $3, $4::platform.access_role) returning id::text`, [handle, `Invented ${handle}`, email, access]))!.id;
  const emailOf = async (id: string) => (await db.one<{ email: string }>('select email from platform.app_user where id = $1', [id]))!.email;
  const kinds = async (id: string) => (await addressesOf(id, db)).map((a) => `${a.kind}:${a.address}`).sort().join(' ');
  try {
    const ana = await user(handles[0]!, 'ana@invented-default.test', 'admin');
    const ben = await user(handles[1]!, 'ben@invented-default.test');

    // ── The default-to and app_user.email, from either side ──────────────────────────────────
    const created = await kinds(ana);
    await db.query(`update platform.app_user set email = 'ana.new@invented-default.test' where id = $1`, [ana]);
    const afterEmail = await kinds(ana);
    await db.query(`update platform.user_address set address = 'ana@invented-default.test' where user_id = $1 and kind = 'default'`, [ana]);
    const followed = await emailOf(ana);
    await db.query(`insert into platform.user_address (user_id, address, kind) values ($1, 'ana.alias@invented-alias.test', 'alias')`, [ana]);
    const aliasKept = await emailOf(ana);
    check('ADDRESSES app_user.email stays the default-to address, written from either side',
      created === 'default:ana@invented-default.test' && afterEmail === 'default:ana.new@invented-default.test'
        && followed === 'ana@invented-default.test' && aliasKept === 'ana@invented-default.test',
      'Writing app_user.email makes it the default row; writing the default row writes app_user.email; an alias leaves it alone.');

    // ── One owner per address ──────────────────────────────────────────────────────────────
    let dbRefused = false;
    try { await db.query(`insert into platform.user_address (user_id, address, kind) values ($1, 'ANA.ALIAS@invented-alias.test', 'alias')`, [ben]); }
    catch { dbRefused = true; }
    process.env.PLCOS_SECRET = Buffer.alloc(32, 11).toString('base64'); // invented test key
    forgetRootSecret();
    Object.assign(config.auth, { provider: 'google' });
    const { addPersonAction, updateAddressesAction } = await import('../../app/settings/people/actions');
    const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
    const anaEpoch = (await db.one<{ e: number }>('select session_epoch e from platform.app_user where id = $1', [ana]))!.e;
    const v = encodeURIComponent(sessionValue({ id: ana, sessionEpoch: anaEpoch }, 1).value);
    const anaCookie = `${sessionCookie(true)}=${v}; ${sessionCookie(false)}=${v}`;
    const addClash = await inRequest(db, anaCookie, '/settings/people', () => addPersonAction(null, form({ name: 'Invented Clash', email: 'Ana.Alias@invented-alias.test', access: 'gp', allVehicles: 'on' })));
    const editClash = await inRequest(db, anaCookie, '/settings/people', () => updateAddressesAction(null, form({ userId: ben, default: 'ben@invented-default.test', login: '', aliases: 'ana.alias@invented-alias.test' })));
    check('ADDRESSES an address belongs to one person: the database, Add person and Edit addresses refuse a second owner',
      dbRefused && addClash?.ok === false && editClash?.ok === false && /already belongs/.test(editClash.ok === false ? editClash.error : '')
        && await kinds(ben) === 'default:ben@invented-default.test',
      'The same address in another case is refused; nothing is moved from one person to another.');

    // ── People: edits audited; refused under the switcher ─────────────────────────────────────
    const audited = async () => (await db.one<{ n: number }>(`select count(*)::int n from platform.audit_log where action = 'people.addresses_updated' and subject_id = $1`, [ben]))!.n;
    const auditBefore = await audited();
    const edited = await inRequest(db, anaCookie, '/settings/people', () => updateAddressesAction(null, form({ userId: ben, login: 'ben@invented-login.test', default: 'Ben.Main@invented-default.test', aliases: 'ben.old@invented-alias.test\nben.other@invented-alias.test' })));
    const benSet = await kinds(ben);
    Object.assign(config.auth, { provider: 'local' });
    const onMac = await inRequest(db, `${USER_COOKIE}=${handles[0]}`, '/settings/people', () => updateAddressesAction(null, form({ userId: ben, default: 'ben@invented-default.test', login: '', aliases: '' })));
    Object.assign(config.auth, { provider: 'google' });
    check('PEOPLE a person’s login, default-to and aliases are edited exactly, audited, and refused under the Mac’s user switcher',
      edited?.ok === true && benSet === 'alias:ben.old@invented-alias.test alias:ben.other@invented-alias.test default:ben.main@invented-default.test login:ben@invented-login.test'
        && await emailOf(ben) === 'ben.main@invented-default.test' && await audited() === auditBefore + 1
        && onMac?.ok === false && await kinds(ben) === benSet,
      'Addresses are lower-cased; the default-to becomes app_user.email; one audit row (counts, no addresses); the switcher changes nothing.');

    // ── The init file ──────────────────────────────────────────────────────────────────────
    const member = (handle: string, email: string, login: string | null, aliases: string[]): TeamMember =>
      ({ handle, name: `Invented ${handle}`, initials: 'IC', role: null, email, affinityEmail: null, linearEmail: null, login, aliases });
    const cyFull = member(handles[2]!, 'cy@invented-default.test', 'cy@invented-login.test', ['cy.one@invented-alias.test', 'cy.two@invented-alias.test']);
    const first = await db.transaction((tx) => applyTeam(tx, [cyFull]));
    const cy = (await db.one<{ id: string }>('select id::text from platform.app_user where handle = $1', [handles[2]]))!.id;
    const full = await kinds(cy);
    const second = await db.transaction((tx) => applyTeam(tx, [{ ...cyFull, aliases: ['cy.two@invented-alias.test'] }]));
    const exact = await kinds(cy);
    const clash = await db.transaction((tx) => applyTeam(tx, [{ ...cyFull, aliases: ['cy.two@invented-alias.test', 'ben.old@invented-alias.test'] }, member(handles[1]!, 'ben.main@invented-default.test', null, [])]));
    const inFile = validateInit({ team: [member('ina', 'same@invented.test', null, []), member('ino', 'other@invented.test', null, ['SAME@invented.test'])], vehicles: [], answers: {} }).problems;
    const badShape = validateInit({ team: [{ handle: 'ix', name: 'Invented', aliases: 'not-a-list' }, { handle: 'iy', name: 'Invented', login: 'not an address' }], vehicles: [], answers: {} }).problems;
    check('INIT the file sets each person’s exact address set; an address on two people, or someone else’s, is reported and nothing applied',
      first.length === 0 && full === 'alias:cy.one@invented-alias.test alias:cy.two@invented-alias.test default:cy@invented-default.test login:cy@invented-login.test'
        && second.length === 0 && exact === 'alias:cy.two@invented-alias.test default:cy@invented-default.test login:cy@invented-login.test'
        && clash.length === 1 && /ben\.old@invented-alias\.test already belongs to addr-props-ben/.test(clash[0]!) && await kinds(cy) === exact
        && inFile.some((p) => /same@invented\.test is also ina's address/.test(p))
        && badShape.some((p) => /aliases must be a list/.test(p)) && badShape.some((p) => /login must be an email/.test(p)),
      'Dropping an alias from the file drops it here; a clash with another person leaves every row as it was; the shape is validated.');

    // ── Mail matching by an alias ──────────────────────────────────────────────────────────
    const team = await teamAddresses(db);
    const resolve = emailTeamResolver([{ name: 'Invented addr-props-cy', email: 'cy@invented-default.test', addresses: ['cy@invented-login.test', 'cy.two@invented-alias.test'] }]);
    const byAlias = await activeUsersByEmail('CY.TWO@invented-alias.test', db);
    check('MAIL a message from or to any of a person’s addresses is theirs: the comms team map, Affinity email evidence and the roster lookup',
      team.get('cy.two@invented-alias.test') === 'Invented addr-props-cy' && team.get('cy@invented-login.test') === 'Invented addr-props-cy'
        && team.get('ben.old@invented-alias.test') === 'Invented addr-props-ben'
        && resolve({ emailAddress: 'Cy.Two@invented-alias.test' }) === 'Invented addr-props-cy'
        && byAlias.length === 1 && byAlias[0]!.id === cy,
      'comms_ingest and the LP mail trace read teamAddresses; an alias names the person, so the message is ours and not an LP’s.');

    // ── Google sign-in by an alias, through the real route handlers ──────────────────────────
    await withDb(db, () => writeSettings(checkSettings({ 'google.clientId': CLIENT_ID, 'google.clientSecret': CLIENT_SECRET, 'app.publicUrl': PUBLIC }), { actorId: ana, via: 'settings' }));
    useFakeGoogle({ clientSecret: CLIENT_SECRET });
    const { GET: start } = await import('../../app/auth/google/route');
    const { GET: callback } = await import('../../app/auth/google/callback/route');
    const signIn = async (email: string, hd: string) => {
      const begun = await withDb(db, () => start(new Request(`${ORIGIN}/auth/google`, { headers: { host: 'localhost:3113' } })));
      const location = begun.headers.get('location') ?? '';
      const code = fakeConsent(location, { sub: `invented-${email}`, email, email_verified: true, hd });
      const back = await withDb(db, () => callback(new Request(`${PUBLIC}/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(new URL(location).searchParams.get('state') ?? '')}`,
        { headers: { host: 'raise.example.test', cookie: (begun.headers.get('set-cookie') ?? '').split(';')[0]!, 'x-forwarded-for': '192.0.2.30' } })));
      const set = back.headers.getSetCookie().find((c) => c.startsWith(`${sessionCookie(true)}=`)) ?? '';
      return { to: back.headers.get('location') ?? '', user: set ? await withDb(db, () => userFromSession(decodeURIComponent(set.split(';')[0]!.slice(sessionCookie(true).length + 1)), db)) : null };
    };
    const viaAlias = await signIn('cy.two@invented-alias.test', 'invented-alias.test');
    const viaLogin = await signIn('CY@invented-login.test', 'invented-login.test');
    const dropped = await signIn('cy.one@invented-alias.test', 'invented-alias.test');
    check('SIGN-IN a person signs in with any of their addresses — login, default-to or alias — and only those',
      viaAlias.to === `${PUBLIC}/today` && viaAlias.user?.id === cy && viaLogin.user?.id === cy && dropped.to.endsWith('error=not-on-roster'),
      'Through the real /auth/google and callback handlers with the fake Google; an alias removed from the file no longer signs in.');
  } finally {
    useFakeGoogle(null);
    Object.assign(config.auth, { provider: savedProvider });
    if (savedSecret === undefined) delete process.env.PLCOS_SECRET; else process.env.PLCOS_SECRET = savedSecret;
    forgetRootSecret();
    await db.query('delete from platform.setting');
    forgetSettings();
    await loadSettings(db);
    await db.query(`update platform.app_user set active = false where handle = any($1)`, [handles]);
  }
}
