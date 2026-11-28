// [Codex] Test del contratto tra gateway Forgia e worker Builda.
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createBuildaWorker } from '../server/builda.ts';
import { diskStorage } from '../server/disk.ts';

const request = { problem: 'calibration', engineVersion: '0.1.0', datasetVersion: 'synthetic-v1' };

async function setup(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'forgia-builda-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())));
  const address = server.address();
  assert(address && typeof address === 'object');
  return { storage: diskStorage(directory), port: address.port };
}

test('il worker inoltra solo le opzioni Builda e conserva un risultato unico', async t => {
  let runs = 0;
  let input: unknown;
  const { storage, port } = await setup(t, async (req, res) => {
    runs++;
    assert.equal(req.url, '/v1/experiments');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['content-type'], 'application/json');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      schema_version: 1,
      experiment: {
        schema: 'builda.experiment.v1', engine_version: '0.1.0', dataset_version: 'synthetic-v1',
        problem: 'calibration', seed: 42, budget: 64, strategy: 'evolution', provider_cost: 0,
        id: '5e54b2e6-7bbb-4f4d-8413-ce28dfdc5581',
        dataset_sha256: 'a'.repeat(64), champion_sha256: 'b'.repeat(64),
        baseline_holdout_mae: 2, champion_holdout_mae: 1, accepted: true,
      },
    }));
  });
  const worker = createBuildaWorker(storage, port);
  const [first, duplicate] = await Promise.all([worker.runJob(request), worker.runJob(request)]);
  assert.deepEqual(first, duplicate);
  assert.equal(first.cached, false);
  assert.equal(first.receipt.accepted, true);
  assert.deepEqual(input, { problem: 'calibration', seed: 42, budget: 64, strategy: 'evolution' });

  const restarted = createBuildaWorker(storage, port);
  assert.deepEqual(await restarted.runJob({ ...request, seed: 42 }), { ...first, cached: true });
  assert.equal(runs, 1);
});

test('il worker non inoltra richieste non valide e richiede riconciliazione dopo un esito incerto', async t => {
  let runs = 0;
  const { storage, port } = await setup(t, (_req, res) => {
    runs++;
    res.writeHead(503).end();
  });
  const worker = createBuildaWorker(storage, port);
  await assert.rejects(worker.runJob({ ...request, budget: 513 }), { status: 400 });
  assert.equal(runs, 0);
  await assert.rejects(worker.runJob(request), { status: 502 });
  await assert.rejects(createBuildaWorker(storage, port).runJob(request), { status: 409 });
  assert.equal(runs, 1);
});
