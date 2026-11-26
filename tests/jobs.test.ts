import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createJobs} from '../server/jobs.ts';

function memory(initial: string | null = null) {
  let saved = initial;
  return {async getItem() {return saved;}, async setItem(_key: string, value: string) {saved = value;}};
}

test('la coda alterna sessioni e conserva gli esiti', async () => {
  const store = memory(), a = randomUUID(), b = randomUUID();
  const order: string[] = [];
  const release = Promise.withResolvers<void>();
  const jobs = createJobs(store, async ({idea}, backlog) => {
    order.push(idea);
    if (idea === 'Prima') await release.promise;
    return backlog;
  });
  const first = await jobs.submit({provider:'auto', session:a, idea:'Prima'});
  const second = await jobs.submit({provider:'auto', session:a, idea:'Seconda'});
  await jobs.submit({provider:'auto', session:b, idea:'Terza'});
  assert.equal((await jobs.read(first.id))?.status, 'running');
  assert.equal((await jobs.read(second.id))?.status, 'queued');
  release.resolve();
  for (let attempt = 0; attempt < 100 && (await jobs.read(second.id))?.status !== 'done'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.deepEqual(order, ['Prima','Terza','Seconda']);
  const restarted = createJobs(store, async () => assert.fail('Una richiesta completata non va ripetuta.'));
  assert.deepEqual(await restarted.read(second.id), {status:'done',result:0});
});

test('al riavvio riprende il lavoro in attesa e non ripete quello in corso', async () => {
  const session = randomUUID(), interrupted = randomUUID(), queued = randomUUID();
  const input = {idea:'Idea',provider:'auto',consent:false,context:{kind:'catalog',phase:'draft'}};
  const jobs = createJobs(memory(JSON.stringify([
    {id:interrupted,session,status:'running',input}, {id:queued,session,status:'queued',input},
  ])), async request => request.consent);
  assert.equal((await jobs.read(interrupted))?.status, 'failed');
  for (let attempt = 0; attempt < 100 && (await jobs.read(queued))?.status !== 'done'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.deepEqual(await jobs.read(queued), {status:'done',result:false});
});
