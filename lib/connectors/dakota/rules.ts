import { config } from '@/config/deployment';
import type { RecordFields } from './replica';
export function usd(value: unknown): number | null {
  if (value == null) return null;
  const m=/^(?:US\s*)?\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|mm|mn|b|bn|thousand|million|billion)?$/i.exec(String(value).trim());
  if(!m)return null;
  const unit=(m[2]??'').toLowerCase();
  const amount=Number(m[1]!.replaceAll(',',''))*(/^(k|thousand)$/.test(unit)?1e3:/^(m|mm|mn|million)$/.test(unit)?1e6:/^(b|bn|billion)$/.test(unit)?1e9:1);
  return Number.isFinite(amount)&&amount>0?amount:null;
}
export const flag = (value: unknown) => /^(true|yes|1)$/i.test(String(value).trim());
export const TICKETS = ['average_ticket_size__c','check_size_from__c','private_equity_average_ticket_size__c'];
const TOPICS=['investment_interest__c','investment_focus_single__c','industry_focus__c','sector__c','asset_classes__c'];
/** Strict word boundaries prevent AI from matching unrelated words (e.g. retail). */
const has = (text: string, term: string) => new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^a-z0-9]|$)`,'i').test(text);
export function thesisFor(vehicle: {slug:string;name:string}): string[] {
  const text=`${vehicle.slug} ${vehicle.name}`.toLowerCase().replaceAll('_',' ').replaceAll('-',' ');
  const key=text.includes('prime intellect')?'prime-intellect':text.includes('persona')?'persona-ai':text.includes('netho')?'netholabs':text.includes('crypto')||text.includes('rails')?'rails':text.includes('neuro')?'neurotech':null;
  return key?config.dakota.theses[key]??[]:[];
}
export function accountFit(record: RecordFields, vehicle: {slug:string;name:string}) {
  const thesis=thesisFor(vehicle); if(!thesis.length)return null;
  const matched=TOPICS.flatMap(field=>thesis.filter(t=>has(record[field]??'',t)).map(t=>`${field}=${t}`));
  const flags: string[]=[];
  if(thesis.includes('venture')&&flag(record.venture_capital__c))flags.push('venture_capital__c=true');
  if(thesis.includes('crypto')&&flag(record.cryptocurrency__c))flags.push('cryptocurrency__c=true');
  if(!matched.length&&!flags.length)return null;
  const tickets=TICKETS.filter(f=>(usd(record[f])??0)>=config.dakota.minimumTicketUsd);
  const allocator=/\b(family[ -]office|foundation|endowment|fund[ -]of[ -]funds)\b/i.test(record.type??'');
  const allocatorFlag=flag(record.venture_capital__c)?'venture_capital__c':flag(record.cryptocurrency__c)?'cryptocurrency__c':null;
  if(!tickets.length&&!(allocator&&allocatorFlag))return null;
  const sizeRule=tickets.length?`ticket-at-least-500k (${tickets.map(f=>`${f}=${record[f]}`).join(', ')})`:`fund-allocator-with-flag (type=${record.type}, ${allocatorFlag}=true; size inferred by allocator rule)`;
  return {score:matched.length*config.dakota.fitWeights.topic+flags.length*config.dakota.fitWeights.flag,
    reason:`dakota-fit-v1: ${[...matched,...flags].join(', ')}; ${sizeRule}`};
}
export function ticketEstimate(record: RecordFields): {amount:number;basis:string}|null {
  const field=TICKETS.find(f=>usd(record[f])!==null); if(!field)return null;
  return {amount:usd(record[field])!,basis:`Estimate from Dakota ${field}=${record[field]}; source dakota, as of ${new Date(record.lastmodifieddate).toISOString()}. A vendor ticket-size claim, not a commitment to this vehicle.`};
}
export const contactRelevance = (title: string|null) => /\b(cio|chief investment officer)\b/i.test(title??'')?3:/private markets|venture|alternatives|digital assets/i.test(title??'')?2:0;
