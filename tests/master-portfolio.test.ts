import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importPortfolioPlan, planPortfolio} from '../server/masterPortfolioOrchestrator.ts';
import {freeModelPricing, modelFamily, openRouterCatalog, openRouterKeyStatus} from '../server/openRouterCatalog.ts';
import {createProvider} from '../server/providers.ts';

const json = (data: unknown) => Response.json({data});
const model = (id: string, pricing: unknown = {prompt: '0', completion: '0'}) => ({
  id, pricing, context_length: 1024, supported_parameters: ['response_format'],
  architecture: {output_modalities: ['text']},
});

test('import preserves original work, excludes annexes, and protects external and paused work', () => {
  const source = [
    '## 0. Direttive', '## 1. External', '**Priorità: P0 assoluta**',
    'Repository: https://github.com/test/repo', 'Non modificare contemporaneamente il branch assegnato.',
    '1. Recupera il piano', 'docs/MASTER_PLAN.md', '## 2. Paused',
    '**Priorità: P3 temporaneamente sospesa**', '## 3. Main', '**Priorità: P1**',
    '## 4. REPOSITORY AUSILIARIE', 'keep privately', '## 5. PIANIFICAZIONE ESECUTIVA OBBLIGATORIA',
  ].join('\r\n');
  const plan = importPortfolioPlan(source);
  assert.equal(plan.policies.length, 3);
  assert.match(plan.policies[1].sourceSection, /keep privately/);
  plan.projects[0].evidence.push({stage: 'tests', ref: 'example CI run'});
  const [external, main, paused] = planPortfolio(plan.projects);
  assert.deepEqual([external.status, main.status, paused.status], ['external', 'reconcile', 'paused']);
  assert.deepEqual(external.originalReferences, ['docs/MASTER_PLAN.md']);
  assert.equal(external.backlog[0].title, 'Recupera il piano');
  assert.deepEqual(external.delivery.tests, ['example CI run']);
  assert.deepEqual(external.delivery.signedBuild, []);
  assert.throws(() => importPortfolioPlan(source.replace('## 4.', '## 7.')), /consecutive/);
});

test('catalog accepts only unique, explicit free models and detects requested and new families', async () => {
  const result = await openRouterCatalog(async (url, init) => {
    assert.match(String(url), /\/models$/);
    assert.equal(init?.headers, undefined);
    return json([
      model('google/gemma-test:free'), model('newco/next:free'),
      model('openai/gpt'), model('qwen/qwen:free', {prompt: '0', completion: '0', request: '0.1'}),
      model('nvidia/nemotron:free'), model('nvidia/nemotron:free'),
    ]);
  });
  assert.deepEqual(result.map(item => item.family), ['Gemma', 'newco']);
  assert.equal(result[0].structuredOutput, true);
  assert.equal(modelFamily('google/gemini-example:free'), 'Gemini');
  assert.equal(freeModelPricing({prompt: '1e-1000', completion: '0'}), false);
  assert.equal(freeModelPricing({prompt: '0e-10', completion: 0}), true);
});

test('key audit exposes validated limit and never serializes labels or secrets', async () => {
  const status = await openRouterKeyStatus('fixture', async (url, init) => {
    assert.match(String(url), /\/key$/);
    assert.deepEqual(init?.headers, {Authorization: 'Bearer fixture'});
    return json({limit: 20, limit_reset: 'monthly', limit_remaining: 17, label: 'fixture'});
  });
  assert.equal(status.monthlyLimit20UsdVerified, true);
  assert.equal(status.automaticTopUp, null);
  assert.equal(status.accountBalanceUsd, null);
  assert.doesNotMatch(JSON.stringify(status), /fixture/);
});

test('OpenRouter inference requests carry the free pricing and fallback guardrails', async () => {
  const adapter = createProvider({id: 'openrouter', model: 'qwen/example:free', apiKey: 'fixture'},
    async (url, init) => {
      if (url.endsWith('/models')) return json([model('qwen/example:free')]);
      const request = JSON.parse(String(init?.body));
      assert.equal(request.model, 'qwen/example:free');
      assert.deepEqual(request.provider.max_price, {prompt: 0, completion: 0, request: 0});
      assert.equal(request.provider.allow_fallbacks, false);
      assert.equal(request.provider.require_parameters, true);
      return Response.json({choices: [{message: {content: '{}'}}]});
    });
  assert.equal(await adapter.eligible(), true);
  assert.equal(await adapter.complete('fixture', AbortSignal.timeout(1000)), '{}');
});
