import type { MessagePort } from 'node:worker_threads';
import { TooManyRows, type Db, type Queryable } from './index';
import { withBackgroundDb } from './scheduling';

type Request = {id:number; method:'query'|'one'|'exec'|'begin'|'commit'|'rollback'; transaction?:number; sql?:string; params?:unknown[]};
type Fault = {message:string;name:string;code?:string;digest?:string};
type Reply = {id:number;value?:unknown;error?:Fault};
const fault = (error:unknown):Fault => { const e=(error instanceof Error?error:new Error('Database operation failed')) as Error & {code?:string;digest?:string}; return {message:e.message??'Database operation failed',name:e.name??'Error',code:e.code,digest:e.digest}; };
/** A job gets access to the existing owner, never permission to open another directory. */
export function hostJobDb(db:Db,port:MessagePort):()=>void {
  const transactions=new Map<number,{tx:Queryable;finish:(commit:boolean)=>void;complete:Promise<unknown>}>();
  let closed=false;
  const reply=(message:Reply)=>{if(!closed)port.postMessage(message);};
  port.on('message',async (request:Request)=>{
    const {id,method}=request;
    try {
      if(method==='begin') {
        let entered!:(tx:Queryable)=>void,failed!:(error:unknown)=>void,finish!:(commit:boolean)=>void;
        const ready=new Promise<Queryable>((resolve,reject)=>{entered=resolve;failed=reject;});
        const done=new Promise<boolean>(resolve=>{finish=resolve;});
        const complete=withBackgroundDb(()=>db.transaction(async tx=>{entered(tx);if(!await done)throw new Error('Job transaction rolled back.');}));
        complete.catch(failed);
        const tx=await ready;
        if(closed){finish(false);return;}
        transactions.set(id,{tx,finish,complete});reply({id,value:id});return;
      }
      const transaction=request.transaction===undefined?undefined:transactions.get(request.transaction);
      if(request.transaction!==undefined&&!transaction)throw new Error('Unknown job transaction.');
      if(method==='commit'||method==='rollback') {
        if(!transaction)throw new Error('Missing job transaction.');
        transaction.finish(method==='commit');
        try {await transaction.complete;} catch(error){if(method==='commit')throw error;}
        transactions.delete(request.transaction!);reply({id});return;
      }
      const queryable=transaction?.tx??db;
      const run=():Promise<unknown>=>method==='exec'?queryable.exec(request.sql!):method==='one'?queryable.one(request.sql!,request.params):queryable.query(request.sql!,request.params);
      const value=await withBackgroundDb(run);reply({id,value});
    }catch(error){reply({id,error:fault(error)});}
  });
  const close=()=>{if(closed)return;closed=true;for(const tx of transactions.values())tx.finish(false);transactions.clear();port.close();};
  port.once('close',close);
  return close;
}
/** The normal Db API, with transaction calls pinned to the host's single callback lifetime. */
export function connectJobDb(port:MessagePort,kind:Db['kind']):Db {
  let sequence=0,closed=false;
  const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
  port.on('message',(reply:Reply)=>{
    const waiter=pending.get(reply.id);if(!waiter)return;pending.delete(reply.id);
    if(reply.error){const e=reply.error.name==='TooManyRows'?new TooManyRows(2):new Error(reply.error.message);Object.assign(e,reply.error);waiter.reject(e);}else waiter.resolve(reply.value);
  });
  port.once('close',()=>{closed=true;for(const waiter of pending.values())waiter.reject(new Error('Database owner disconnected.'));pending.clear();});
  const call=<T>(request:Omit<Request,'id'>):Promise<T>=>new Promise((resolve,reject)=>{if(closed){reject(new Error('Database owner disconnected.'));return;}const id=++sequence;pending.set(id,{resolve:resolve as (value:unknown)=>void,reject});try{port.postMessage({...request,id});}catch(error){pending.delete(id);reject(error);}});
  const queryable=(transaction?:number):Queryable=>({query:(sql,params)=>call({method:'query',sql,params,transaction}),one:(sql,params)=>call({method:'one',sql,params,transaction}),exec:sql=>call({method:'exec',sql,transaction})});
  return {...queryable(),kind,transaction:async fn=>{const transaction=await call<number>({method:'begin'});try{const result=await fn(queryable(transaction));await call({method:'commit',transaction});return result;}catch(error){await call({method:'rollback',transaction}).catch(()=>{});throw error;}},close:async()=>{port.close();}};
}
