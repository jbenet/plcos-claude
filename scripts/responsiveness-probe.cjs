// Independent clock: requests continue arriving while the server event loop is blocked.
const { parentPort, workerData } = require('node:worker_threads');
const http = require('node:http');
const { performance } = require('node:perf_hooks');
const samples = { trivial: [], journal: [] };
let pending=0, stopping=false, errors=0;
const inflight=new Map();
let sequence=0;
const agent=new http.Agent({keepAlive:true,maxSockets:1024});
function finish() {
  if (!stopping || pending) return;
  agent.destroy();
  parentPort.postMessage({samples,errors});
}
function probe(route) {
  const start=performance.now(); pending++;
  if(workerData.dispatch) {const id=++sequence;inflight.set(id,{route,start});parentPort.postMessage({id,route});return;}
  const req=http.request({host:'127.0.0.1',port:workerData.port,path:'/'+route,method:route==='journal'?'POST':'GET',agent},res=>{
    res.resume(); res.on('end',()=>{samples[route].push(performance.now()-start);if(res.statusCode!==200)errors++;pending--;finish();});
  });
  req.on('error',()=>{errors++;pending--;finish();});
  req.end();
}
const timer=setInterval(()=>{probe('trivial');probe('journal');},100);
parentPort.on('message',message=>{
  if(message==='stop') {stopping=true;clearInterval(timer);finish();return;}
  const sample=inflight.get(message.id);if(!sample)return;inflight.delete(message.id);
  samples[sample.route].push(performance.now()-sample.start);if(message.error)errors++;pending--;finish();
});
parentPort.postMessage('ready');
