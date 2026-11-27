import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTap } from './windows-acceptance.mjs';

const ids = ['RC26', 'RC27', 'RC63', 'RC64', 'RC65'];
const good = ids.map((id, i) => `ok ${i + 1} - ${id} fixture`).join('\n') + '\nok 6 - RC25 non-Windows # SKIP\n# tests 6\n# pass 5\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n';
test('acceptance requires all five native cases and complete clean TAP counts', () => {
  assert.equal(evaluateTap(good, 0).pass, true);
  assert.equal(evaluateTap(good.replace('RC65', 'RC66'), 0).pass, false);
  assert.equal(evaluateTap(good.replace('RC65 fixture', 'RC65 fixture # SKIP'), 0).pass, false);
  assert.equal(evaluateTap(good.replace('RC65 fixture', 'RC65 fixture # TODO'), 0).pass, false);
  assert.equal(evaluateTap(good.replace('# skipped 1', '# skipped 2'), 0).pass, false);
  assert.equal(evaluateTap(good.replace('# fail 0\n', ''), 0).pass, false);
  assert.equal(evaluateTap(good + '# pass 5\n', 0).pass, false);
  assert.equal(evaluateTap(good.replace('RC25 non-Windows', 'RC99 unexpected'), 0).pass, false);
  assert.equal(evaluateTap(good, 1).pass, false);
  assert.equal(evaluateTap(good, null).pass, false);
});
