import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pilotIdentity} from '../server/pilot.ts';
import {createGateway} from '../server/gateway.ts';
import {createJobs} from '../server/jobs.ts';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const token = 'a'.repeat(64);
const bearer = 'Bearer ' + token;

test('il token pilota identifica il tester solo entro la scadenza e finché è autorizzato', () => {
  const entry = {id: alice, sha256: createHash('sha256').update(token).digest('hex'), expiresAt: '2026-11-13T00:00:00Z'};
  assert.equal(pilotIdentity(bearer, [entry], Date.parse('2026-11-12')), alice);
  assert.equal(pilotIdentity(bearer, [entry], Date.parse('2026-11-13')), undefined);
  assert.equal(pilotIdentity(bearer, [], Date.parse('2026-11-12')), undefined);
  assert.equal(pilotIdentity('Bearer ' + 'b'.repeat(64), [entry], Date.parse('2026-11-12')), undefined);
});

test('un retry restituisce il lavoro originale e un altro tester non può leggerlo', {timeout: 1000}, async () => {
  const data = new Map<string, string>();
  const store = {
    async getItem(key: string) { return data.get(key) ?? null; },
    async setItem(key: string, value: string) { data.set(key, value); },
  };
  let requests = 0;
  const jobs = createJobs(store, async () => ++requests);
  const body = {idea: 'Catalogo di piante', session: alice, provider: 'auto'};
  const [first, retry] = await Promise.all([jobs.submit(body, 'project:p1'), jobs.submit(body, 'project:p1')]);
  assert.deepEqual(retry, first);
  assert.deepEqual(await jobs.submit({...body, cloudConsent: true, provider: 'llamacpp'}, 'project:p1'), first);
  assert.equal(await jobs.read(first.id, bob), null);
  while ((await jobs.read(first.id, alice))?.status !== 'done') {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.deepEqual(await jobs.submit({...body, idea: 'Contesto riformattato'}, 'project:p1'), first);
  const reopened = createJobs(store, async () => ++requests);
  assert.deepEqual(await reopened.submit(body, 'project:p1'), first);
  assert.equal(requests, 1);
  const next = await reopened.submit({...body, idea: 'Un’altra richiesta'}, 'project:p2');
  assert.notEqual(next.id, first.id);
});

test('due tester condividono la quota ma non la risposta in cache', async () => {
  const data = new Map<string, string>();
  const gateway = createGateway({
    async getItem(key) { return data.get(key) ?? null; },
    async setItem(key, value) { data.set(key, value); },
  }, {dailyLimit: 2});
  const provider = {
    id: 'local', model: 'fixture', mode: 'local' as const,
    eligible: async () => true,
    complete: async () => JSON.stringify({name: 'Orto', idea: 'Catalogo', kind: 'catalog', quiz: false,
      items: [{name: 'Lavanda', category: 'Aromatiche', color: ''}]}),
  };
  assert.equal((await gateway.plan('Stessa idea', provider, false, alice)).cached, false);
  assert.equal((await gateway.plan('Stessa idea', provider, false, bob)).cached, false);
  assert.equal((await gateway.plan('Stessa idea', provider, false, alice)).cached, true);
  const state = JSON.parse(data.get('gateway.v1')!);
  assert.deepEqual(state.cache, {});
  assert.equal(Object.keys(state.pilotCache).length, 2);
  await assert.rejects(gateway.plan('Nuova idea', provider, false, alice), /Quota/);
});
