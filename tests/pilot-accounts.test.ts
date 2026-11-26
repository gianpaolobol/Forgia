import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pilotIdentity, validatePilotAccounts} from '../server/pilot.ts';

const token = 'a'.repeat(64), other = 'b'.repeat(64);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const alice = {id: '11111111-1111-4111-8111-111111111111', sha256: digest(token), expiresAt: '2026-11-26T00:00:00Z'};
const bob = {id: '22222222-2222-4222-8222-222222222222', sha256: digest(other), expiresAt: '2026-11-26T00:00:00.0000000+00:00'};
const now = Date.parse('2026-11-25T00:00:00Z');
const identify = (entries: unknown, value = token, at = now) => pilotIdentity('Bearer ' + value, entries, at);
const invalid = /^Elenco tester pilota non valido\.$/;

test('valid unique accounts and UTC timestamps', () => {
  assert.equal(identify([alice, bob]), alice.id);
  assert.equal(identify([bob, alice], other), bob.id);
  assert.equal(validatePilotAccounts([alice, bob]).length, 2);
});
test('expiry boundary and complete revocation', () => {
  assert.equal(identify([alice], token, Date.parse(alice.expiresAt)), undefined);
  assert.equal(identify([]), undefined);
  assert.equal(identify([bob]), undefined);
});
test('invalid bearer never identifies', () => {
  assert.equal(pilotIdentity('Bearer bad', [alice], now), undefined);
  assert.equal(pilotIdentity(undefined, [alice], now), undefined);
});
for (const second of [{...bob, sha256: alice.sha256}, {...bob, id: alice.id}, alice,
  {...bob, sha256: alice.sha256, expiresAt: '2025-01-01T00:00:00Z'}]) {
  test('ambiguous snapshot rejected in either order, including expired entries', () => {
    assert.throws(() => identify([alice, second]), {message: invalid});
    assert.throws(() => identify([second, alice]), {message: invalid});
  });
}
for (const entry of [null, [], {}, {...bob, id: 'invalid'}, {...bob, sha256: 'invalid'},
  {...bob, expiresAt: 'tomorrow'}, {...bob, expiresAt: '2026-02-30T00:00:00Z'},
  {...bob, expiresAt: '2026-11-25T24:00:00Z'}, {...bob, expiresAt: '2026-11-26T00:00:00'},
  {...bob, expiresAt: '2026-11-26T01:00:00+01:00'}]) {
  test('malformed entry rejects entire snapshot without exposing fields', () => {
    assert.throws(() => validatePilotAccounts([alice, entry]), {message: invalid});
    assert.throws(() => identify([alice, entry]), {message: invalid});
  });
}
test('non-array snapshot is rejected', () => {
  for (const entries of [null, {}, '[]']) assert.throws(() => validatePilotAccounts(entries), {message: invalid});
});
test('next snapshot is independently validated, never reusing an earlier identity', () => {
  assert.equal(identify([alice]), alice.id);
  assert.throws(() => identify([alice, {...bob, sha256: alice.sha256}]), {message: invalid});
  assert.equal(identify([bob]), undefined);
  assert.equal(identify([alice, bob]), alice.id);
});
