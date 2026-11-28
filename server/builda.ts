// [Codex] Loopback-only worker for Builda experiments.
import { createHash } from 'node:crypto';
import { request, type IncomingMessage } from 'node:http';
import type { Storage } from '../src/core/storage.ts';

const problems = ['calibration', 'terrain'] as const;
const strategies = ['evolution', 'random', 'rules', 'classifier', 'baseline'] as const;
const maxResponseBytes = 256 * 1024;
const timeoutMs = 30_000;
type Problem = typeof problems[number];
type Strategy = typeof strategies[number];
type Options = { problem: Problem; seed: number; budget: number; strategy: Strategy };
type Job = Options & { engineVersion: string; datasetVersion: string };
type Receipt = {
  experimentId: string;
  accepted: boolean;
  datasetSha256: string;
  championSha256: string;
  baselineHoldoutMae: number;
  championHoldoutMae: number;
};

export function buildaError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function member<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.some(choice => choice === value);
}

function wholeNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function version(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/.test(value);
}

function jobFrom(value: unknown): Job {
  if (!record(value)) throw buildaError(400, 'Job Builda non valido.');
  const { problem, seed = 42, budget = 64, strategy = 'evolution', engineVersion, datasetVersion } = value;
  if (Object.keys(value).some(key => ![
    'problem', 'seed', 'budget', 'strategy', 'engineVersion', 'datasetVersion',
  ].includes(key))) throw buildaError(400, 'Opzione Builda sconosciuta.');
  if (!member(problem, problems) || !member(strategy, strategies) ||
      !wholeNumber(seed, 0, 2 ** 32 - 1) || !wholeNumber(budget, 1, 512) ||
      !version(engineVersion) || !version(datasetVersion)) {
    throw buildaError(400, 'Parametri, strategia o versioni Builda non validi.');
  }
  return { problem, seed, budget, strategy, engineVersion, datasetVersion };
}

function sha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function errorMetric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function receiptFrom(value: unknown): Receipt {
  if (!record(value)) throw buildaError(502, 'Ricevuta Builda non valida.');
  const { experimentId, accepted, datasetSha256, championSha256, baselineHoldoutMae, championHoldoutMae } = value;
  if (typeof experimentId !== 'string' || !/^[0-9a-f-]{36}$/.test(experimentId) ||
      typeof accepted !== 'boolean' || !sha256(datasetSha256) || !sha256(championSha256) ||
      !errorMetric(baselineHoldoutMae) || !errorMetric(championHoldoutMae)) {
    throw buildaError(502, 'Ricevuta Builda non valida.');
  }
  return { experimentId, accepted, datasetSha256, championSha256, baselineHoldoutMae, championHoldoutMae };
}

async function readExperiment(response: IncomingMessage, job: Job): Promise<Receipt> {
  const contentType = response.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (response.statusCode !== 200 || contentType !== 'application/json') {
    response.destroy();
    throw buildaError(502, 'Builda ha restituito una risposta non valida.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > maxResponseBytes) throw buildaError(502, 'Risposta Builda troppo grande.');
    chunks.push(chunk);
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw buildaError(502, 'JSON Builda non valido.');
  }
  if (!record(body) || body.schema_version !== 1 || !record(body.experiment)) {
    throw buildaError(502, 'Schema risposta Builda non supportato.');
  }
  const result = body.experiment;
  if (result.schema !== 'builda.experiment.v1' || result.engine_version !== job.engineVersion ||
      result.dataset_version !== job.datasetVersion || result.problem !== job.problem ||
      result.seed !== job.seed || result.budget !== job.budget || result.strategy !== job.strategy ||
      result.provider_cost !== 0) {
    throw buildaError(502, 'Risposta incoerente con il job Builda richiesto.');
  }
  return receiptFrom({
    experimentId: result.id,
    accepted: result.accepted,
    datasetSha256: result.dataset_sha256,
    championSha256: result.champion_sha256,
    baselineHoldoutMae: result.baseline_holdout_mae,
    championHoldoutMae: result.champion_holdout_mae,
  });
}

function loadSaved(raw: string): Receipt {
  try {
    const state: unknown = JSON.parse(raw);
    if (!record(state) || state.version !== 1) throw Error();
    if (state.status === 'awaiting_receipt') {
      throw buildaError(409, 'Esito Builda da riconciliare prima di un nuovo invio.');
    }
    if (state.status !== 'completed') throw Error();
    return receiptFrom(state.receipt);
  } catch (error) {
    if (record(error) && error.status === 409) throw error;
    throw buildaError(409, 'Registro job Builda da verificare.');
  }
}

type JobResult = { jobId: string; cached: boolean; receipt: Receipt };

export function createBuildaWorker(store: Storage, port: number) {
  if (!wholeNumber(port, 1, 65_535) || port === 8787) throw Error('Porta locale Builda non valida.');
  let active: { id: string; task: Promise<JobResult> } | undefined;

  async function runJob(value: unknown): Promise<JobResult> {
    const job = jobFrom(value);
    const jobId = createHash('sha256').update(JSON.stringify(['builda-experiment-v1', job])).digest('hex');
    if (active?.id === jobId) return active.task;
    if (active) throw buildaError(429, 'Worker Builda occupato.');

    const task = (async () => {
      const key = `builda.job.v1.${jobId}`;
      const saved = await store.getItem(key);
      if (saved !== null) return { jobId, cached: true, receipt: loadSaved(saved) };
      await store.setItem(key, JSON.stringify({ version: 1, status: 'awaiting_receipt' }));
      const { problem, seed, budget, strategy } = job;
      let receipt: Receipt;
      try {
        const body = JSON.stringify({ problem, seed, budget, strategy });
        const response = await new Promise<IncomingMessage>((resolve, reject) => {
          const outbound = request({
            hostname: '127.0.0.1',
            port,
            path: '/v1/experiments',
            method: 'POST',
            agent: false,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            signal: AbortSignal.timeout(timeoutMs),
          }, resolve);
          outbound.once('error', reject);
          outbound.end(body);
        });
        receipt = await readExperiment(response, job);
      } catch {
        throw buildaError(502, 'Esito Builda da riconciliare. Consultare il registro Builda.');
      }
      await store.setItem(key, JSON.stringify({ version: 1, status: 'completed', receipt }));
      return { jobId, cached: false, receipt };
    })();

    active = { id: jobId, task };
    try {
      return await task;
    } finally {
      active = undefined;
    }
  }

  return { runJob };
}
