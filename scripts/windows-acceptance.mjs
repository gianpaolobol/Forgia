import { spawnSync } from 'node:child_process';
import { release } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const required = ['RC26', 'RC27', 'RC63', 'RC64', 'RC65'];
const files = ['remote-windows-key', 'remote-durable-vertical', 'remote-local-supervisor', 'remote-credential-vault'].map(name => `tests/${name}.test.ts`);

export function evaluateTap(tap, status) {
  const lines = tap.split(/\r?\n/);
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => {
    const matches = lines.filter(line => new RegExp(`^# ${key} \\d+$`).test(line));
    return [key, matches.length === 1 ? Number(matches[0].split(' ').at(-1)) : null];
  }));
  const cases = Object.fromEntries(required.map(id => {
    const matches = lines.filter(line => new RegExp(`^(?:not )?ok \\d+ - ${id} `).test(line));
    return [id, matches.length === 1 && matches[0].startsWith('ok ') && !/ # (?:SKIP|TODO)\b/i.test(matches[0])];
  }));
  const skips = lines.filter(line => /^ok \d+ - .* # SKIP\b/i.test(line));
  const expectedSkip = skips.length === 1 && /^ok \d+ - RC25 /.test(skips[0]);
  const pass = status === 0 && counts.tests > 0 && counts.tests === counts.pass + 1 &&
    counts.skipped === 1 && expectedSkip && ['fail', 'cancelled', 'todo'].every(key => counts[key] === 0) && Object.values(cases).every(Boolean);
  return { pass, counts, cases };
}

function run() {
  if (process.platform !== 'win32' || process.versions.node.split('.')[0] !== '24') {
    return { pass: false, reason: 'requires-windows-node24' };
  }
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const git = args => spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 15000, windowsHide: true });
  const head = git(['rev-parse', 'HEAD']);
  const clean = git(['status', '--porcelain', '--untracked-files=normal']);
  const sha = head.stdout?.trim();
  if (head.status !== 0 || !/^[a-f0-9]{40}$/.test(sha ?? '') || clean.status !== 0 || clean.stdout.trim() !== '') {
    return { pass: false, reason: 'requires-clean-git-checkout' };
  }
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap', ...files], {
    cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  const result = evaluateTap(child.stdout ?? '', child.status);
  const finalHead = git(['rev-parse', 'HEAD']);
  const finalClean = git(['status', '--porcelain', '--untracked-files=normal']);
  const unchanged = finalHead.status === 0 && finalHead.stdout.trim() === sha && finalClean.status === 0 && finalClean.stdout.trim() === '';
  return { ...result, pass: result.pass && !child.error && unchanged, sha, node: process.versions.node,
    windows: release(), unchanged, scope: 'windows-dpapi-loopback-fixtures-only' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = run();
  // Never forward raw test output, paths, environment, SID or credentials.
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.pass ? 0 : 1;
}
