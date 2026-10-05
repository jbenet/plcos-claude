export type { ApprovalDecision, ApprovalKind, ApprovalTicket, TicketScope } from './types';
export { KIND_CLASS, KIND_GATES } from './types';
export { AUTONOMOUS, PERSON, PERSON_EXEMPT, ticketNeeded, type Acting } from './autonomy';
export {
  findOpenTicket, getTicket, insertTicket, listDecidedTickets, listOpenTickets, ticketCounts,
} from './repo';
export { TicketRequired, decideTicket, openTicket, requireApprovedTicket } from './service';
export type { OpenTicketCommand } from './service';
