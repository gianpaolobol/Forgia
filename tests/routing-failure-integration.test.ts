import test from 'node:test';
import assert from 'node:assert/strict';
import {createGateway} from '../server/gateway.ts';
import {ProviderError, type Provider} from '../server/providers.ts';
import {createJobs} from '../server/jobs.ts';

const context = {kind: 'catalog', phase: 'draft'} as const;
const sample = {name:'Erbario', idea:'Catalogo di piante', kind:'catalog', quiz:false,
  items:[{name:'Lavanda', category:'Piante', color:''}]};
const memory = () => {
  const data = new Map<string, string>();
  return {async getItem(k: string) {return data.get(k) ?? null;},
    async setItem(k: string,v: string) {data.set(k,v);}};
};
function fixture(id='local', overrides: Partial<Provider> = {}): Provider {
  return {id, model:'fixture', mode:id==='local'?'local':'free',
    eligible:async()=>true, complete:async()=>JSON.stringify(sample), ...overrides};
}
const statusIs = (status: number) => (error: unknown) => error instanceof ProviderError && error.status === status;

test('assenza motori, consenso negato e input fuori capacità non sono quota', async () => {
  const g = createGateway(memory());
  await assert.rejects(g.planAuto('Idea', [], true, context), statusIs(503));
  await assert.rejects(g.planAuto('Idea', [fixture('groq')], false, context), statusIs(503));
  await assert.rejects(g.planAuto('Idea', [fixture('local', {fit:{maxInputBytes:1}})], false, context), statusIs(503));
});
test('riserva e quota locale producono 429 senza nuovo invio', async () => {
  const g = createGateway(memory(), {dailyLimit:1});
  let calls=0;
  const p=fixture('local',{complete:async()=>{calls++;return JSON.stringify(sample);}});
  await g.planAuto('Prima', [p], false, context);
  await assert.rejects(g.planAuto('Seconda', [p], false, context), statusIs(429));
  await assert.rejects(g.planAuto('Idea', [fixture('groq')], true, context, 2), statusIs(429));
  assert.equal(calls,1);
});
for(const status of [401,403,429,500,503] as const) {
  test(`errore provider ${status} classificato in auto e manuale`, async () => {
    const p=fixture('local',{complete:async()=>{throw new ProviderError('fixture',status);}});
    const expected=status===500?503:status;
    await assert.rejects(createGateway(memory()).planAuto('Idea',[p],false,context),statusIs(expected));
    await assert.rejects(createGateway(memory()).plan('Idea',p,false),statusIs(expected));
  });
}
test('JSON non valido, eleggibilità negata e timeout non sono quota', async () => {
  for(const [p,status] of [
    [fixture('local',{complete:async()=>'{'}),502],
    [fixture('local',{eligible:async()=>false}),403],
    [fixture('local',{complete:async()=>{throw new DOMException('fixture','TimeoutError');}}),504],
  ] as const) {
    await assert.rejects(createGateway(memory()).planAuto('Idea',[p],false,context),statusIs(status));
    await assert.rejects(createGateway(memory()).plan('Idea',p,false),statusIs(status));
  }
});
test('fallback riuscito, poi quota mista a errore auth', async () => {
  const cloud=fixture('groq',{complete:async()=>{throw new ProviderError('fixture',429);}});
  const result=await createGateway(memory()).planAuto('Idea',[cloud,fixture()],true,context);
  assert.equal(result.routing.provider,'local');
  assert.deepEqual(result.routing.skipped,['groq']);
  const auth=fixture('local',{complete:async()=>{throw new ProviderError('fixture',401);}});
  await assert.rejects(createGateway(memory()).planAuto('Idea',[cloud,auth],true,context),statusIs(401));
});
test('errore di scrittura arresta il routing prima di invocare il provider', async () => {
  let calls=0;
  const p=fixture('local',{complete:async()=>{calls++;return JSON.stringify(sample);}});
  const store={...memory(),async setItem(){throw Error('fixture disco');}};
  await assert.rejects(createGateway(store).planAuto('Idea',[p,fixture('groq')],true,context),/fixture disco/);
  assert.equal(calls,0);
});
test('coda conserva causa auth senza trasformarla in quota', async () => {
  const jobs=createJobs(memory(),async()=>{throw new ProviderError('fixture auth',401);});
  const receipt=await jobs.submit({idea:'Idea',provider:'local',session:'00000000-0000-0000-0000-000000000000'});
  for(let i=0;i<100;i++){
    const job=await jobs.read(receipt.id);
    if(job?.status==='failed'){assert.equal(job.statusCode,401);return;}
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.fail('job non terminato');
});
