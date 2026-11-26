import test from 'node:test';
import assert from 'node:assert/strict';
import {knownRoutingStatus, normalizeRoutingStatus, summarizeRoutingFailure} from '../server/routingFailure.ts';
for (const status of [401, 403, 429, 502, 503, 504] as const) {
  test(`preserva causa ${status}`, () => {
    assert.equal(normalizeRoutingStatus(status), status);
    assert.equal(summarizeRoutingFailure([status]).status, status);
  });
}
test('nessuna causa osservata non è quota', () => {
  assert.equal(summarizeRoutingFailure([]).status, 503);
});
test('429 misto non nasconde auth o rete, indipendente dall’ordine', () => {
  for (const status of [401, 403, 502, 503, 504] as const) {
    assert.equal(summarizeRoutingFailure([429, status]).status, status);
    assert.equal(summarizeRoutingFailure([status, 429]).status, status);
  }
});
test('priorità stabile e messaggi redatti', () => {
  const result = summarizeRoutingFailure([503, 429, 401, 502]);
  assert.equal(result.status, 401);
  assert.match(result.message, /credenziali/);
});
test('status non ammessi normalizzati senza propagazione arbitraria', () => {
  for (const raw of [undefined, null, '429', 200, 400, 418, 600, NaN, '__proto__']) {
    assert.equal(knownRoutingStatus(raw), false);
    assert.equal(normalizeRoutingStatus(raw), 502);
  }
  assert.equal(normalizeRoutingStatus(500), 503);
  assert.equal(normalizeRoutingStatus(599), 503);
});
