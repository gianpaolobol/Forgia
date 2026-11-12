import test from 'node:test';
import assert from 'node:assert/strict';
import {createGateway} from '../server/gateway.ts';
import {createProvider, ProviderError, type Provider} from '../server/providers.ts';
import {parseFit, rankProviders, routingContext} from '../server/routing.ts';

const sample = {name:'Erbario', idea:'Catalogo di piante', kind:'catalog', quiz:false,
  items:[{name:'Lavanda', category:'Piante', color:''}]};

function fixture(id: string, calls: string[], overrides: Partial<Provider> = {}): Provider {
  return {
    id, model: id + '-fixture', mode: id === 'local' ? 'local' : 'free',
    eligible: async () => true,
    complete: async () => { calls.push(id); return JSON.stringify(sample); },
    ...overrides,
  };
}

function memory() {
  const data = new Map<string, string>();
  return {
    async getItem(k: string) { return data.get(k) ?? null; },
    async setItem(k: string, v: string) { data.set(k, v); },
  };
}

test('famiglia e fase cambiano il candidato iniziale', () => {
  const providers = ['local', 'groq', 'openrouter'].map(id => fixture(id, []));
  const pick = (kind: string, phase: string) =>
    rankProviders(providers, routingContext(kind, phase), 'idea', true, {local:20, groq:20, openrouter:20})[0].provider.id;
  assert.equal(pick('catalog', 'draft'), 'groq');
  assert.equal(pick('catalog', 'revision'), 'openrouter');
  assert.equal(pick('tracker', 'draft'), 'openrouter');
  assert.equal(pick('community', 'draft'), 'openrouter');
});

test('capacità, quota e profilo del modello determinano i candidati', () => {
  const providers = [
    fixture('local', [], {fit: parseFit('{"catalog":10}')}),
    fixture('groq', [], {fit: parseFit('{"maxInputBytes":3}')}),
    fixture('openrouter', []),
  ];
  const ranked = rankProviders(providers, routingContext('catalog', 'draft'), 'èè', true, {local:1, groq:20, openrouter:0});
  assert.deepEqual(ranked.map(r => r.provider.id), ['local']);
  assert.throws(() => parseFit('{"catalog":99}'), /profilo/i);
});

test('senza consenso la scelta automatica non chiama il cloud', async () => {
  const calls: string[] = [];
  const g = createGateway(memory());
  const result = await g.planAuto('Catalogo', ['groq','openrouter','local'].map(id => fixture(id,calls)),
    false, routingContext('catalog','draft'));
  assert.deepEqual(calls, ['local']);
  assert.equal(result.routing.provider, 'local');
});

test('i tre adattatori partecipano al percorso con fallback gratuito e tracciato', async () => {
  const calls: string[] = [];
  const local = fixture('local', calls);
  const groq = fixture('groq', calls, {
    complete: async () => { calls.push('groq'); throw new ProviderError('Quota',429); },
  });
  const router = createProvider({id:'openrouter',model:'example/model:free',apiKey:'test-only'}, async url => {
    if (url.endsWith('/models')) {
      return Response.json({data:[{id:'example/model:free',pricing:{prompt:'1',completion:'0'}}]});
    }
    calls.push('openrouter');
    throw Error('Modello non gratuito interrogato.');
  });
  const g = createGateway(memory());
  const result = await g.planAuto('Catalogo', [groq,local,router], true, routingContext('catalog','draft'));
  assert.equal(result.routing.provider,'local');
  assert.deepEqual(calls,['groq','local']);
  assert.deepEqual(result.routing.skipped,['groq']);
  const revision = await g.planAuto('Revisione', [groq,local,router], true, routingContext('catalog','revision'));
  assert.deepEqual(revision.routing.skipped,['openrouter']);
  assert.equal(revision.routing.provider,'local');
});

test('quota automatica rispettata anche dopo riavvio', async () => {
  const store = memory(), calls: string[] = [];
  const providers = ['groq','local'].map(id => fixture(id,calls));
  const context = routingContext('catalog','draft');
  await createGateway(store,{dailyLimit:1}).planAuto('Idea 1',providers,true,context);
  await createGateway(store,{dailyLimit:1}).planAuto('Idea 2',providers,true,context);
  await assert.rejects(createGateway(store,{dailyLimit:1}).planAuto('Idea 3',providers,true,context), /nessun motore/i);
  assert.deepEqual(calls,['groq','local']);
});

test('le bozze semplici usano il locale e il carico aumenta la riserva cloud', () => {
  const local = fixture('local', []);
  const groq = fixture('groq', []);
  const draft = routingContext('catalog', 'draft');
  const quota = {local: Infinity, groq: 7};
  assert.equal(rankProviders([groq, local], draft, 'Idea', true, quota, 0)[0].provider.id, 'local');
  assert.equal(rankProviders([groq], draft, 'Idea', true, quota, 0).length, 1);
  assert.equal(rankProviders([groq], draft, 'Idea', true, quota, 2).length, 0);
  assert.equal(rankProviders([groq], routingContext('catalog', 'revision'), 'Idea', true, quota, 2).length, 1);
});

test('llama.cpp e Cloudflare rispettano endpoint e modalità gratuita', async () => {
  const signal = new AbortController().signal;
  const llama = createProvider({id:'llamacpp', model:'forgia-local'}, async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:8080/v1/chat/completions');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return Response.json({choices:[{message:{content:'{}'}}]});
  });
  assert.equal(llama.mode, 'local');
  assert.equal(await llama.complete('Idea', signal), '{}');
  const config = {id:'cloudflare',model:'@cf/meta/llama-3.1-8b-instruct',accountId:'a'.repeat(32),apiKey:'test'};
  assert.throws(() => createProvider(config), /Workers Free/);
  const cf = createProvider({...config,freePlanConfirmed:true}, async (url, init) => {
    assert.equal(url, 'https://api.cloudflare.com/client/v4/accounts/' + config.accountId + '/ai/run/' + config.model);
    assert.equal(JSON.parse(init?.body as string).max_tokens, 2000);
    return Response.json({success:true,result:{response:'{}'}});
  });
  assert.equal(await cf.complete('Idea', signal), '{}');
});
