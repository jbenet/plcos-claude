import type { ApprovalKind } from './types';

/**
 * Who needs a ticket (Juan, 5 Oct 2026). "this seems like complexity overkill. i think we want to be
 * super clear on what outreach has happened and equip senders with clear visual info so they can make
 * the best decision there, but not create super complex approval flows that will just grind things to
 * confusion or halts. if this was for automated agents only, ok, but not for humans (we're slow)".
 *
 * So SEND and INTRO_ASK are gated only for an autonomous agent: a token, or one call, flagged
 * autonomous — juanmail running a batch with no human click. A person — anyone using the app, or a
 * token acting for its owner interactively (a person clicked) — needs no ticket for either; they see
 * the outreach context instead (last touches, who owes a reply, other vehicles, who is in the thread,
 * restrictions in red, the material's wrap and 506(c) flags). MONEY, STAGE and ALLOCATION_EXCEPTION
 * are unchanged: every actor needs one.
 *
 * Restrictions (rule 8), the grants gate (rule 12) and the wrap check (rule 11) are not tickets. They
 * still refuse or warn whoever acts; this changes only who needs an approval first.
 */
export const PERSON_EXEMPT: readonly ApprovalKind[] = ['SEND', 'INTRO_ASK'];

/** How an action is being taken: by a person, or by an agent with no human in the loop. */
export interface Acting {
  /** True only when a token or the call itself is flagged autonomous. Default false: a person. */
  autonomous: boolean;
}

export const PERSON: Acting = { autonomous: false };
export const AUTONOMOUS: Acting = { autonomous: true };

/** Whether this kind needs an approved ticket when taken this way. Fails closed for any kind not exempted. */
export function ticketNeeded(kind: ApprovalKind, acting: Acting): boolean {
  return acting.autonomous || !PERSON_EXEMPT.includes(kind);
}
