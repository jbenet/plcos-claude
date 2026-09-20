import { getDb, type Queryable } from '@/lib/db';
import {
  INSUFFICIENT_FOR_506C, type AccreditationGate, type AccreditationRecord, type Channel,
  type ClaimStatus, type PublicClaim, type SideLetter, type SolicitationEvent,
  type VerificationMethod, type VerificationStatus,
} from './types';

type AccRow = {
  record_id: string; entity_id: string; entity_name: string; vehicle_id: string;
  vehicle_name: string; exemption: string; method: VerificationMethod;
  status: VerificationStatus; evidence_ref: string | null; verified_by_name: string | null;
  verified_on: Date | string | null; expires_on: Date | string | null; note: string | null;
};

const ACC_SELECT = `
  select a.record_id, a.entity_id, e.display_name as entity_name, a.vehicle_id,
         v.name as vehicle_name, v.exemption, a.method, a.status, a.evidence_ref,
         u.name as verified_by_name, a.verified_on, a.expires_on, a.note
    from compliance.accreditation a
    join identity.entity e on e.entity_id = a.entity_id
    join platform.vehicle v on v.id = a.vehicle_id
    left join platform.app_user u on u.id = a.verified_by`;

/**
 * Whether a record actually satisfies the vehicle's exemption.
 *
 * The rule that matters: under 506(c) a self-certification is not reasonable steps, so a
 * row can exist, be complete, and still be insufficient. The gate reads this rather than
 * the existence of a row.
 */
function judge(r: AccRow): { sufficient: boolean; why: string } {
  const expired = r.expires_on !== null && new Date(r.expires_on).getTime() < Date.now();
  if (r.exemption === '506(b)') {
    return {
      sufficient: true,
      why: '506(b) does not require verification, only a reasonable belief. Recorded for the file.',
    };
  }
  if (r.exemption === 'n/a') {
    return { sufficient: true, why: 'Not a securities offering.' };
  }
  if (r.status !== 'verified') {
    return {
      sufficient: false,
      why: `Status is "${r.status}". 506(c) requires verification to be complete, not in progress.`,
    };
  }
  if (INSUFFICIENT_FOR_506C.includes(r.method)) {
    return {
      sufficient: false,
      why: `Method is "${r.method}", which is not reasonable steps under 506(c) no matter who signed it.`,
    };
  }
  if (expired) {
    return {
      sufficient: false,
      why: `Verification expired on ${new Date(r.expires_on!).toISOString().slice(0, 10)}. Accreditation is a point-in-time finding.`,
    };
  }
  return { sufficient: true, why: 'Verified by reasonable steps, unexpired.' };
}

const toRecord = (r: AccRow): AccreditationRecord => {
  const j = judge(r);
  return {
    recordId: r.record_id, entityId: r.entity_id, entityName: r.entity_name,
    vehicleId: r.vehicle_id, vehicleName: r.vehicle_name, exemption: r.exemption,
    method: r.method, status: r.status, evidenceRef: r.evidence_ref,
    verifiedByName: r.verified_by_name,
    verifiedOn: r.verified_on ? new Date(r.verified_on) : null,
    expiresOn: r.expires_on ? new Date(r.expires_on) : null,
    note: r.note, sufficient: j.sufficient, why: j.why,
  };
};

export async function listAccreditation(): Promise<AccreditationRecord[]> {
  const db = await getDb();
  return (await db.query<AccRow>(`${ACC_SELECT} order by v.sort_order, e.display_name`)).map(toRecord);
}

/**
 * The gate. Called before money moves on a 506(c) vehicle.
 *
 * A missing record is refused, not waved through: permitted-by-omission is exactly the
 * failure mode a verification obligation exists to prevent.
 */
export async function accreditationGate(
  entityId: string, vehicleId: string, q?: Queryable,
): Promise<AccreditationGate> {
  const db = q ?? (await getDb());
  const row = await db.one<AccRow>(
    `${ACC_SELECT} where a.entity_id = $1 and a.vehicle_id = $2`,
    [entityId, vehicleId],
  );
  if (!row) {
    const vehicle = await db.one<{ name: string; exemption: string }>(
      'select name, exemption from platform.vehicle where id = $1', [vehicleId],
    );
    if (!vehicle || vehicle.exemption !== '506(c)') return { ok: true, reason: null };
    return {
      ok: false,
      reason:
        `No accreditation record exists for this subscriber on ${vehicle.name}, which is 506(c). ` +
        'Verification by reasonable steps is an obligation, and a missing record is refused ' +
        'rather than assumed satisfied.',
    };
  }
  const judged = toRecord(row);
  return judged.sufficient ? { ok: true, reason: null } : { ok: false, reason: judged.why };
}

type ClaimRow = {
  claim_id: string; statement: string; channel: Channel; asset_title: string | null;
  vehicle_name: string | null; first_used_on: Date | string; substantiation: string;
  substantiation_ref: string | null; reviewed_by_name: string | null;
  reviewed_on: Date | string | null; status: ClaimStatus;
};

export async function listPublicClaims(): Promise<PublicClaim[]> {
  const db = await getDb();
  const rows = await db.query<ClaimRow>(
    `select c.claim_id, c.statement, c.channel, a.title as asset_title, v.name as vehicle_name,
            c.first_used_on, c.substantiation, c.substantiation_ref, u.name as reviewed_by_name,
            c.reviewed_on, c.status
       from compliance.public_claim c
       left join content.asset a on a.asset_id = c.asset_id
       left join platform.vehicle v on v.id = c.vehicle_id
       left join platform.app_user u on u.id = c.reviewed_by
      order by c.first_used_on desc`,
  );
  return rows.map((r) => ({
    claimId: r.claim_id, statement: r.statement, channel: r.channel,
    assetTitle: r.asset_title, vehicleName: r.vehicle_name,
    firstUsedOn: new Date(r.first_used_on), substantiation: r.substantiation,
    substantiationRef: r.substantiation_ref, reviewedByName: r.reviewed_by_name,
    reviewedOn: r.reviewed_on ? new Date(r.reviewed_on) : null, status: r.status,
  }));
}

export async function listSolicitations(): Promise<SolicitationEvent[]> {
  const db = await getDb();
  const rows = await db.query<{
    event_id: string; vehicle_name: string; exemption: string; channel: Channel;
    audience: string; occurred_on: Date | string; asset_title: string | null;
    recorded_by_name: string; note: string | null;
  }>(
    `select s.event_id, v.name as vehicle_name, v.exemption, s.channel, s.audience,
            s.occurred_on, a.title as asset_title, u.name as recorded_by_name, s.note
       from compliance.solicitation s
       join platform.vehicle v on v.id = s.vehicle_id
       join platform.app_user u on u.id = s.recorded_by
       left join content.asset a on a.asset_id = s.asset_id
      order by s.occurred_on desc`,
  );
  return rows.map((r) => ({
    eventId: r.event_id, vehicleName: r.vehicle_name, exemption: r.exemption,
    channel: r.channel, audience: r.audience, occurredOn: new Date(r.occurred_on),
    assetTitle: r.asset_title, recordedByName: r.recorded_by_name, note: r.note,
    incident: r.exemption === '506(b)',
  }));
}

export async function listSideLetters(): Promise<SideLetter[]> {
  const db = await getDb();
  const rows = await db.query<{
    letter_id: string; entity_name: string; vehicle_name: string; provision: string;
    mfn: boolean; risk: string; signed_on: Date | string | null; reviewed_by_name: string | null;
  }>(
    `select l.letter_id, e.display_name as entity_name, v.name as vehicle_name, l.provision,
            l.mfn, l.risk, l.signed_on, u.name as reviewed_by_name
       from compliance.side_letter l
       join identity.entity e on e.entity_id = l.entity_id
       join platform.vehicle v on v.id = l.vehicle_id
       left join platform.app_user u on u.id = l.reviewed_by
      order by l.mfn desc, l.signed_on`,
  );
  return rows.map((r) => ({
    letterId: r.letter_id, entityName: r.entity_name, vehicleName: r.vehicle_name,
    provision: r.provision, mfn: r.mfn, risk: r.risk,
    signedOn: r.signed_on ? new Date(r.signed_on) : null,
    reviewedByName: r.reviewed_by_name,
  }));
}
