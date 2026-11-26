import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {openNotificationLocal,NotificationLocalRuntime} from '../server/notificationLocalRuntime.ts';
import {startNotificationDashboard} from '../server/notificationLocalDashboard.ts';
import {NotificationHub} from '../server/notificationHub.ts';

const project='demo/project';
const event=(id:string,p=project)=>({version:1,id,source:'fixture',project:p,type:'ci.failed',severity:'warning',
 timestamp:1,correlation_id:id,evidence_url:'https://github.com/'+p+'/actions/runs/123'});
async function fixture(t:import('node:test').TestContext){
  const dir=mkdtempSync(join(realpathSync(tmpdir()),'forgia-dashboard-')),db=openNotificationLocal(dir,true);
  const runtime=new NotificationLocalRuntime(db,'alice',project);
  const foreign=new NotificationLocalRuntime(db,'alice','demo/other');
  const bob=new NotificationLocalRuntime(db,'bob',project);
  const h=new NotificationHub(db);
  h.setPreference('alice',project,'email',true);
  h.setPreference('alice','demo/other','email',true);
  runtime.publish(event('one'));foreign.publish(event('foreign','demo/other'));bob.publish(event('bob'));
  const panel=await startNotificationDashboard(runtime);
  t.after(async()=>{await panel.close();db.close();rmSync(dir,{recursive:true,force:true});});
  const authorization='Basic '+Buffer.from('operator:'+panel.password).toString('base64');
  const get=async(path='/',headers:Record<string,string>={})=>fetch(panel.origin+path,{headers:{authorization,...headers},redirect:'manual'});
  const post=async(path:string,body:Record<string,string>,headers:Record<string,string>={})=>fetch(panel.origin+path,{
    method:'POST',headers:{authorization,origin:panel.origin,'content-type':'application/x-www-form-urlencoded',...headers},
    body:new URLSearchParams(body),redirect:'manual'});
  const token=async()=>{const html=await (await get()).text();return html.match(/name="csrf" value="([a-zA-Z0-9_-]+)"/)![1];};
  return {panel,get,post,token,runtime,foreign,bob};
}
test('N8a local HTTP authentication, host and no-store headers',async t=>{
  const f=await fixture(t);
  assert.match(f.panel.origin,/^http:\/\/127\.0\.0\.1:[0-9]+$/);
  assert.equal((await fetch(f.panel.origin)).status,401);
  assert.equal((await f.get('/',{authorization:'Basic bad'})).status,401);
  const wrongHost=await new Promise<number|undefined>((resolve,reject)=>{
    const req=request(f.panel.origin,{headers:{Host:'external.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();
  });assert.equal(wrongHost,403);
  assert.equal((await f.get('/',{'sec-fetch-site':'cross-site'})).status,403);
  const res=await f.get();assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
  assert.match(res.headers.get('content-security-policy')!,/frame-ancestors 'none'/);
  assert.equal(res.headers.get('access-control-allow-origin'),null);
  assert.ok(!(await res.text()).includes(f.panel.password));
});
test('N8b responsive scoped inbox, valid evidence, read via POST and CSRF',async t=>{
  const f=await fixture(t);const csrf=await f.token();
  const html=await (await f.get()).text();
  assert.match(html,/name="viewport"/);assert.match(html,/demo\/project/);
  assert.match(html,/https:\/\/github.com\/demo\/project\/actions\/runs\/123/);
  assert.ok(!html.includes('demo/other')&&!html.includes('value="foreign"')&&!html.includes('value="bob"'));
  assert.equal((await f.get('/read')).status,404);
  assert.equal((await f.post('/read',{csrf,source:'fixture',id:'one'},{origin:'http://wrong.invalid'})).status,403);
  assert.equal((await f.post('/read',{csrf:'wrong',source:'fixture',id:'one'})).status,403);
  assert.equal((await f.post('/read',{csrf,source:'fixture',id:'foreign'})).status,404);
  assert.equal(f.runtime.snapshot().unread,1);
  assert.equal((await f.post('/read',{csrf,source:'fixture',id:'one'})).status,303);
  assert.equal(f.runtime.snapshot().unread,0);assert.equal(f.foreign.snapshot().unread,1);assert.equal(f.bob.snapshot().unread,1);
  assert.match(await (await f.get('/?unread=1')).text(),/Nessun evento/);
});
test('N8c scoped revoke, schedule, no activation or external transport',async t=>{
  const f=await fixture(t),csrf=await f.token();
  assert.equal((await f.post('/revoke',{csrf,channel:'email',project:'demo/other'})).status,400);
  assert.equal((await f.post('/activate',{csrf,channel:'email'})).status,404);
  assert.equal((await f.post('/revoke',{csrf,channel:'email'})).status,303);
  assert.equal(f.runtime.snapshot().channels[0].preferenceEnabled,false);
  assert.equal(f.foreign.snapshot().channels[0].preferenceEnabled,true);
  assert.equal((await f.post('/schedule',{csrf,time:'24:00'})).status,400);
  assert.equal((await f.post('/schedule',{csrf,time:'08:30'})).status,303);
  assert.equal(f.runtime.snapshot().schedule.minute,510);
  assert.equal((await f.post('/tick',{csrf})).status,303);
  assert.equal((await f.post('/schedule',{csrf,time:'off'})).status,303);
  assert.equal(f.runtime.snapshot().schedule.minute,null);
  assert.ok(f.runtime.snapshot().channels.every(c=>!c.transportActive));
});
