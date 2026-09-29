import type { AffinityContext } from './affinity-fixtures';
import { touchpoints } from '../../lib/connectors/affinity/translate';
import { resolveEntity } from '../../modules/identity/create';
import type { PersonIdentity } from '../../lib/connectors/affinity/participants';

export async function affinityParticipantProperties({ adb, check }: AffinityContext) {
  const rollback = new Error('rollback invented interaction fixtures');
  try {
    await adb.transaction(async tx => {
      const entity = async (kind = 'person') => (await tx.one<{ id: string }>(
        `insert into identity.entity (entity_type,display_name) values ($1::identity.entity_type,'Invented history fixture') returning entity_id as id`, [kind]))!.id;
      const a = await entity(), b = await entity(), old = await entity(), org = await entity('org');
      const account = (await tx.one<{ id: string; handle: string; name: string }>(`select id,handle,name from platform.app_user where active limit 1`))!;
      const user = account.id;
      let staff = (await tx.one<{ entity_id: string }>(`select entity_id from identity.source_record where source='app_user' and source_id=$1`, [account.handle]))?.entity_id;
      if (!staff) {
        staff = await entity();
        await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values('app_user',$1,$2,'human:fixture')`, [account.handle, staff]);
      }
      await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values('affinity','person:94509',$1,'human:fixture')`, [staff]);
      await tx.query('update identity.entity set merged_into=$2 where entity_id=$1', [old, a]);
      for (const [key, id] of [['person:94501', a], ['person:94503', b], ['person:94504', old], ['company:94501', org]]) {
        await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values ('affinity',$1,$2,'human:fixture')`, [key, id]);
      }
      await tx.query(`insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id)
        values ('not_same_as','affinity','person:94505','affinity','person:94501')`);
      await resolveEntity(tx, {type: 'person', name: 'Invented history fixture', source: 'affinity', sourceId: 'person:94501', domains: ['example.invalid']});
      const persons: PersonIdentity[] = [
        { id: 94501, primaryEmailAddress: 'one@example.invalid', emailAddresses: ['alternate@example.invalid', 'shared@example.invalid'] },
        { id: 94502, firstName: 'Invented', lastName: 'history fixture', primaryEmailAddress: 'alternate@example.invalid', emailAddresses: ['older@example.invalid'] },
        { id: 94503, primaryEmailAddress: 'other@example.invalid', emailAddresses: ['shared@example.invalid'] },
        { id: 94505, primaryEmailAddress: 'one@example.invalid', emailAddresses: ['denied-bridge@example.invalid'] },
        { id: 94508, primaryEmailAddress: 'denied-bridge@example.invalid' },
        { id: 94506, primaryEmailAddress: 'contact@firm.invalid', fields: [{ name: 'Organizations', value: { type: 'company-multi', data: [{ id: 94501 }] } }] },
      ];
      const team = [{ handle: 'fixture', email: 'team@example.invalid' }], users = new Map([['fixture', user]]);
      const mt = (id: number, people: Array<{ emailAddress: string | null; person: { id: number; firstName: string | null; lastName: string | null; primaryEmailAddress: string | null; type: 'external' | 'internal' } | null }>) => ({
        id, title: null, startTime: '2018-01-01T00:00:00Z', endTime: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: null,
        attendeesPreview: { data: people, totalCount: people.length },
      });
      const p = (id: number) => ({ id, firstName: null, lastName: null, primaryEmailAddress: null, type: 'external' as const });
      const meetings = [mt(94501, [{ emailAddress: null, person: p(94502) }, { emailAddress: 'team@example.invalid', person: null }]),
        mt(94502, [{ emailAddress: null, person: p(94507) }]), mt(94503, [{ emailAddress: null, person: p(94504) }]),
        mt(94504, [{ emailAddress: null, person: p(94506) }]),
        mt(94505, [{ emailAddress: null, person: p(94501) }, { emailAddress: null, person: { ...p(94509), type: 'internal' } }])];
      const email = (id: number, address: string) => ({ id, type: 'email' as const, sentAt: '2017-01-01T00:00:00Z',
        from: { emailAddress: address }, to: [{ emailAddress: 'team@example.invalid' }] });
      const mail = [email(94501, ' OLDER@example.invalid '), email(94502, 'shared@example.invalid'), email(94503, 'unrelated@example.invalid')];
      const notes = [{ id: 94501, type: 'interaction' as const, content: null, creator: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: null,
        interaction: { id: 94501, type: 'meeting' as const }, personsPreview: { data: [p(94502)], totalCount: 1 } }];
      const entries = [{ id: 94501, type: 'person' as const, listId: 1, createdAt: '2026-01-01T00:00:00Z',
        entity: { id: 94501, fields: [{ id: 'invented-last-email', name: 'Last Email', type: 'global',
          value: { type: 'interaction', data: { id: 94504, type: 'email', sentAt: '2026-01-01T00:00:00Z',
            from: { emailAddress: 'team@example.invalid' }, to: [{ emailAddress: 'one@example.invalid' }] } } }] } }];
      const run = () => touchpoints(tx, entries, notes, meetings, team, users, user, [], [], [], persons, mail);
      await run();
      const rows = () => tx.query<{ entity_id: string; source_ref: string; held_on: string; owner_id: string }>(
        `select entity_id, source_ref, held_on::text, owner_id from meetings.meeting where source='affinity' and source_ref like 'interaction:%:945%:%'`);
      const first = await rows();
      const named = await tx.one<{ attendees: string[] }>(`select attendees from meetings.meeting
        where source='affinity' and source_ref like 'interaction:meeting:94505:%' and entity_id=$1`, [a]);
      check('Affinity calendar team participant resolves by canonical person ID without an email',
        named?.attendees.includes(account.name) === true,
        'A settled app_user identity link retains the named team participant for W3; no email or name guess is required.');
      const sent = await tx.one<{ attendees: string[] }>(`select attendees from meetings.meeting
        where source='affinity' and source_ref like 'interaction:email:94504:%' and entity_id=$1`, [a]);
      check('Affinity list-entry outbound email retains its named sender for W3',
        sent?.attendees.includes(account.name) === true,
        'The sender is a participant even when the entry supplies only an email address and no internal person object.');
      const alias = await tx.one<{ entity_id: string }>(`select entity_id from identity.source_record where source='affinity' and source_id='person:94502'`);
      check('Off-list participants join by matching name and email domain; email-only team members retain ownership',
        alias?.entity_id === a && first.some(r => r.source_ref.startsWith('interaction:email:94501:') && r.entity_id === a) &&
        first.some(r => r.source_ref.startsWith('interaction:meeting:94501:') && r.owner_id === user && r.held_on === '2018-01-01'),
        'Old calendar and email records linked; note creation did not replace calendar date.');
      check('Ambiguous addresses, same-domain strangers and human not-same assertions never merge',
        !first.some(r => /interaction:email:9450[23]:/.test(r.source_ref)) &&
        !(await tx.one(`select 1 from identity.source_record where source='affinity' and source_id in ('person:94505','person:94508')`)),
        'Shared full address rejected; domain alone rejected; explicit denial also blocks indirect bridges.');
      check('Merged identities resolve canonically and explicit company contacts link pursued organizations',
        first.some(r => r.source_ref.startsWith('interaction:meeting:94503:') && r.entity_id === a) &&
        first.some(r => r.source_ref.startsWith('interaction:meeting:94504:') && r.entity_id !== org) &&
        !!(await tx.one(`select 1 from identity.affiliation where org_entity=$1`, [org])),
        'Canonical person and associated company contact retain histories without inventing historical employment.');
      persons.push({ id: 94507, firstName: 'Invented', lastName: 'history fixture', primaryEmailAddress: 'alternate@example.invalid' });
      await run();
      const replay = await rows();
      await run();
      check('A person arriving after an interaction links on replay without refetch or duplicate touchpoints',
        replay.length === first.length + 1 && (await rows()).length === replay.length &&
        replay.some(r => r.source_ref.startsWith('interaction:meeting:94502:') && r.entity_id === a),
        'Late identity recovers one historical interaction; another replay adds none.');
      throw rollback;
    });
  } catch (e) { if (e !== rollback) throw e; }
}
