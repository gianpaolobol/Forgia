import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

type Task = {id:string; depends:string[]; criterion:string};
type Baseline = {project:string; planner:string; reviewer:string; executors:string[]; tasks:Task[]};
type Lease = {id:string; actor:string; fence:number};
type Row = {id:string; status:string; actor:string|null; fence:number; until:number|null; handoffs:number; evidence:string|null; checkpoint:string|null};
const id = (v:unknown):v is string => typeof v==='string' && /^[a-z][a-z0-9_-]{0,63}$/.test(v);
const digest = (v:unknown):v is string => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const record = (v:unknown):v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v);
const exact = (v:Record<string,unknown>,keys:string[]) => Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));
function requireThat(ok:unknown,message='Transizione Superhandy non consentita.'):asserts ok {if(!ok)throw Error(message);}
export function validateBaseline(value:unknown):Baseline {
 requireThat(record(value)&&exact(value,['project','planner','reviewer','executors','tasks']),'Baseline non valida.');
 const {project,planner,reviewer,executors,tasks}=value;
 requireThat(id(project)&&id(planner)&&id(reviewer)&&planner!==reviewer&&Array.isArray(executors)&&executors.length>0&&executors.length<=64&&executors.every(id)&&new Set(executors).size===executors.length&&!executors.includes(reviewer)&&Array.isArray(tasks)&&tasks.length>0&&tasks.length<=256,'Ruoli o task non validi.');
 const parsed=tasks.map((t:unknown):Task=>{
  requireThat(record(t)&&exact(t,['id','depends','criterion'])&&id(t.id)&&Array.isArray(t.depends)&&t.depends.every(id)&&new Set(t.depends).size===t.depends.length&&typeof t.criterion==='string'&&t.criterion.trim().length>0&&Buffer.byteLength(t.criterion)<=2000,'Task non valido.');
  return {id:t.id,depends:[...t.depends],criterion:t.criterion};
 });
 const byId=new Map(parsed.map(t=>[t.id,t]));requireThat(byId.size===parsed.length,'Task duplicato.');
 const visiting=new Set<string>(),done=new Set<string>();
 function visit(key:string){
  if(done.has(key))return;
  requireThat(!visiting.has(key)&&byId.has(key),'Dipendenza assente o ciclo.');
  visiting.add(key);for(const d of byId.get(key)!.depends)visit(d);visiting.delete(key);done.add(key);
 }
 for(const t of parsed)visit(t.id);
 return {project,planner,reviewer,executors:[...executors],tasks:parsed};
}
// Trusted local operator only: declared actor IDs are NOT authenticated identities.
// No provider call, repository write or external execution occurs here.
export function openSuperhandyLedger(path:string,initialize=false,clock=Date.now){
 const db=new DatabaseSync(path,{open:true,readOnly:false});
 const q=(sql:string)=>db.prepare(sql);
 function tx<T>(fn:()=>T):T {db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}
 function now(){const n=clock();requireThat(Number.isSafeInteger(n)&&n>=0&&n<=253402300000000,'Clock non valido.');return n;}
 try{
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  if(initialize)db.exec(`BEGIN IMMEDIATE;
   CREATE TABLE sh_baseline (singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL, sha TEXT NOT NULL, approval TEXT);
   CREATE TABLE sh_task (id TEXT PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('queued','claimed','dispatched','submitted','accepted','uncertain','blocked')),actor TEXT,fence INTEGER NOT NULL DEFAULT 0,until INTEGER,handoffs INTEGER NOT NULL DEFAULT 0,evidence TEXT,checkpoint TEXT);
   CREATE TABLE sh_event (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,task TEXT,evidence TEXT);
   COMMIT;`);
  q('SELECT singleton,body,sha,approval FROM sh_baseline').all();q('SELECT id,status,actor,fence,until,handoffs,evidence,checkpoint FROM sh_task').all();q('SELECT seq,at,actor,action,task,evidence FROM sh_event LIMIT 1').all();
 }catch(e){db.close();throw e;}
 function baseline(){
  const r=q('SELECT body,sha,approval FROM sh_baseline WHERE singleton=1').get();requireThat(r,'Baseline assente.');
  const body=String(r.body),plan=validateBaseline(JSON.parse(body));
  requireThat(createHash('sha256').update(body).digest('hex')===r.sha&&JSON.stringify(plan)===body&&(r.approval===null||digest(r.approval)),'Baseline corrotta.');
  return {plan,sha:String(r.sha),approval:r.approval as string|null};
 }
 function event(actor:string,action:string,task:string|null=null,evidence:string|null=null){q('INSERT INTO sh_event(at,actor,action,task,evidence) VALUES(?,?,?,?,?)').run(now(),actor,action,task,evidence);}
 function row(key:string):Row {const r=q('SELECT * FROM sh_task WHERE id=?').get(key);requireThat(r,'Task assente.');return r as unknown as Row;}
 function recover(n:number){
  for(const r of q("SELECT * FROM sh_task WHERE status IN ('claimed','dispatched') AND until<=?").all(n) as unknown as Row[]){
   const next=r.status==='dispatched'?'uncertain':r.handoffs>=2?'blocked':'queued';
   q('UPDATE sh_task SET status=?,actor=NULL,until=NULL,handoffs=handoffs+? WHERE id=?').run(next,next==='queued'?1:0,r.id);
   event(r.actor!,'expired-'+next,r.id);
  }
 }
 function active(lease:Lease,status:string,n:number){
  requireThat(lease&&id(lease.id)&&id(lease.actor)&&Number.isSafeInteger(lease.fence)&&lease.fence>0);
  const r=row(lease.id);requireThat(r.status===status&&r.actor===lease.actor&&r.fence===lease.fence&&r.until!==null&&r.until>n,'Lease scaduto o non valido.');return r;
 }
 return {
  install(input:unknown){return tx(()=>{
   const plan=validateBaseline(input),body=JSON.stringify(plan),sha=createHash('sha256').update(body).digest('hex');
   requireThat(!q('SELECT 1 FROM sh_baseline').get(),'Baseline immutabile: usare nuovo archivio.');
   q('INSERT INTO sh_baseline(singleton,body,sha) VALUES(1,?,?)').run(body,sha);
   for(const t of plan.tasks)q("INSERT INTO sh_task(id,status) VALUES(?,'queued')").run(t.id);
   event(plan.planner,'baseline',null,sha);return sha;
  });},
  approve(actor:string,sha:string,evidence:string){return tx(()=>{
   const b=baseline();requireThat(actor===b.plan.reviewer&&sha===b.sha&&digest(evidence)&&b.approval===null);
   q('UPDATE sh_baseline SET approval=? WHERE singleton=1').run(evidence);event(actor,'approve',null,evidence);
  });},
  claim(actor:string,ttl=60000,taskId?:string){return tx(()=>{
   const b=baseline(),n=now();requireThat(b.approval&&b.plan.executors.includes(actor)&&Number.isSafeInteger(ttl)&&ttl>0&&ttl<=300000&&(taskId===undefined||id(taskId)));
   recover(n);const task=b.plan.tasks.find(t=>(taskId===undefined||taskId===t.id)&&row(t.id).status==='queued'&&t.depends.every(d=>row(d).status==='accepted'));
   if(!task)return null;
   q("UPDATE sh_task SET status='claimed',actor=?,fence=fence+1,until=? WHERE id=?").run(actor,n+ttl,task.id);event(actor,'claim',task.id);
   const r=row(task.id);return {lease:{id:r.id,actor,fence:r.fence},baselineSha:b.sha,task,checkpoint:r.checkpoint};
  });},
  heartbeat(lease:Lease,ttl=60000){return tx(()=>{
   const n=now(),r=row(lease.id);requireThat(r.status==='claimed'||r.status==='dispatched');active(lease,r.status,n);requireThat(Number.isSafeInteger(ttl)&&ttl>0&&ttl<=300000);
   q('UPDATE sh_task SET until=max(until,?) WHERE id=?').run(n+ttl,lease.id);event(lease.actor,'heartbeat',lease.id);
  });},
  dispatch(lease:Lease){return tx(()=>{active(lease,'claimed',now());q("UPDATE sh_task SET status='dispatched' WHERE id=?").run(lease.id);event(lease.actor,'dispatch',lease.id);});},
  handoff(lease:Lease,checkpoint:string){return tx(()=>{
   const r=active(lease,'claimed',now());requireThat(digest(checkpoint));const next=r.handoffs>=2?'blocked':'queued';
   q('UPDATE sh_task SET status=?,actor=NULL,until=NULL,checkpoint=?,handoffs=handoffs+? WHERE id=?').run(next,checkpoint,next==='queued'?1:0,lease.id);event(lease.actor,'handoff-'+next,lease.id,checkpoint);return next;
  });},
  submit(lease:Lease,evidence:string){return tx(()=>{
   active(lease,'dispatched',now());requireThat(digest(evidence));q("UPDATE sh_task SET status='submitted',until=NULL,evidence=? WHERE id=?").run(evidence,lease.id);event(lease.actor,'submit',lease.id,evidence);
  });},
  review(actor:string,key:string,deliverable:string,decision:'accept'|'reject',evidence:string){return tx(()=>{
   const b=baseline(),r=row(key);requireThat(b.approval&&actor===b.plan.reviewer&&actor!==r.actor&&r.status==='submitted'&&digest(deliverable)&&r.evidence===deliverable&&digest(evidence)&&(decision==='accept'||decision==='reject'));
   q('UPDATE sh_task SET status=?,actor=NULL,checkpoint=NULL,evidence=CASE WHEN ? THEN evidence ELSE NULL END WHERE id=?').run(decision==='accept'?'accepted':'queued',Number(decision==='accept'),key);event(actor,'review-'+decision,key,evidence);
  });},
  inspect(){return tx(()=>{const b=baseline();recover(now());return {baselineSha:b.sha,plan:b.plan,approval:b.approval,tasks:q('SELECT * FROM sh_task ORDER BY rowid').all(),events:q('SELECT * FROM sh_event ORDER BY seq').all()};});},
  close(){db.close();}
 };
}
