import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';

// node --experimental-strip-types iteration12.mjs /path/to/original/server/jobs.ts
const source = await readFile(process.argv[2]);
const sha = createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex');
assert.equal(sha, 'da3209c2d6a36f3e663b4a1c8af30beec8c16502');
const root = await mkdtemp(join(tmpdir(), 'forgia-queue-'));
try {
  await mkdir(join(root, 'server'));
  await mkdir(join(root, 'src/core'), {recursive:true});
  await writeFile(join(root, 'server/jobs.ts'), source);
  await writeFile(join(root, 'server/providers.ts'), 'export const providerIds=["local","llamacpp","groq","openrouter","cloudflare"];\n');
  await writeFile(join(root, 'server/routing.ts'), 'export const routingContext=(kind,phase)=>({kind,phase});\n');
  await writeFile(join(root, 'src/core/spec.ts'), 'export const text=(v)=>v;\n');
  const {createJobs} = await import(pathToFileURL(join(root, 'server/jobs.ts')).href);
  const id='11111111-1111-4111-8111-111111111111';
  const session='22222222-2222-4222-8222-222222222222';
  const other='33333333-3333-4333-8333-333333333333';
  const base={id,session,status:'queued',input:{idea:'synthetic',provider:'groq',consent:false,context:{kind:'catalog',phase:'draft'}}};
  async function run(rows){
    let raw=JSON.stringify(rows), writes=0, calls=[];
    const original=raw;
    const queue=createJobs({async getItem(){return raw;},async setItem(_key,value){writes++;raw=value;}},async(input,_,s)=>{calls.push({input,session:s});return {synthetic:true};});
    let read, rejected=false;
    try {read=await queue.read(id,session);}catch{rejected=true;}
    // Allow all pending queue microtasks to settle; no external I/O in callbacks.
    await sleep(25);
    return {calls,writes,rejected,read,unchanged:raw===original};
  }
  const cases=[
    ['valid persisted queue resumes', [base], r=>{assert.equal(r.calls.length,1);assert.equal(r.calls[0].input.consent,false);assert.equal(r.rejected,false);}],
    ['malformed persisted consent is rejected before dispatch', [{...base,input:{...base.input,consent:'false'}}], blocked],
    ['duplicate persisted id across sessions rejected', [base,{...base,session:other}], blocked],
    ['unknown persisted status rejected', [{...base,status:'unrecognized'}], blocked],
    ['non-array storage rejected', {bad:true}, blocked],
  ];
  function blocked(r){assert.equal(r.rejected,true);assert.equal(r.calls.length,0);assert.equal(r.writes,0);assert.equal(r.unchanged,true);}
  let pass=0,fail=0;
  for(const [name,rows,check] of cases){
    const r=await run(rows);
    try {check(r);pass++;console.log('PASS',name,JSON.stringify(r));}
    catch {fail++;console.log('FAIL',name,JSON.stringify(r));}
  }
  console.log(JSON.stringify({sha,pass,fail}));
  if(fail)process.exitCode=1;
}finally{await rm(root,{recursive:true,force:true});}
