import { createHmac, timingSafeEqual } from 'node:crypto';
import { NotificationHub } from './notificationHub.ts';

const MAX_BODY = 1024 * 1024;
const MAX_AGE = 24 * 60 * 60 * 1000;
type Scope = { owner: string; project: string; repositoryId: number; workflowId: number };
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid GitHub event');
  return v as Record<string, unknown>;
}

// Trusted local caller only. One independent secret per configured repository binding.
// No HTTP listener, webhook registration, delivery of external notifications or raw body logging.
export function ingestGithubRun(hub: NotificationHub, scope: Scope, secret: Buffer,
  body: Buffer, signature: string, now = Date.now()) {
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(scope.owner) ||
      !/^[a-zA-Z0-9_-]{1,64}\/[a-zA-Z0-9_.-]{1,100}$/.test(scope.project) ||
      !positive(scope.repositoryId) || !positive(scope.workflowId) ||
      !Buffer.isBuffer(secret) || secret.length < 32 || secret.length > 1024 ||
      !Number.isSafeInteger(now) || now < 0) throw new Error('Invalid ingress configuration');
  if (!Buffer.isBuffer(body) || body.length === 0 || body.length > MAX_BODY ||
      typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/.test(signature)) throw new Error('Invalid signature or body');
  const expected = createHmac('sha256', secret).update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) throw new Error('Invalid signature or body');
  let parsed: unknown;
  try { parsed = JSON.parse(body.toString('utf8')); } catch { throw new Error('Invalid GitHub event'); }
  const e = record(parsed), repo = record(e.repository), run = record(e.workflow_run);
  // Only one event shape is supported. Unsigned delivery ID/event headers are never identities.
  if (e.action !== 'completed' || run.status !== 'completed' ||
      repo.id !== scope.repositoryId || repo.full_name !== scope.project ||
      run.workflow_id !== scope.workflowId || !positive(run.id) || !positive(run.run_attempt))
    throw new Error('Invalid GitHub event scope');
  if (run.repository !== undefined) {
    const nested = record(run.repository);
    if (nested.id !== scope.repositoryId || nested.full_name !== scope.project) throw new Error('Invalid GitHub event scope');
  }
  if (run.conclusion !== 'success' && run.conclusion !== 'failure' && run.conclusion !== 'timed_out')
    throw new Error('Unsupported GitHub conclusion');
  if (typeof run.updated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(run.updated_at))
    throw new Error('Invalid GitHub timestamp');
  const timestamp = Date.parse(run.updated_at);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || new Date(timestamp).toISOString().replace('.000Z','Z') !== run.updated_at ||
      timestamp < now - MAX_AGE || timestamp > now + 60_000) throw new Error('Invalid GitHub timestamp');
  const runId = String(run.id);
  const success = run.conclusion === 'success';
  // Do not claim artifacts exist, nor forward arbitrary titles, URLs, actor or branch data.
  return hub.publish(scope.owner, {
    version:1, id:'run-'+runId+'-attempt-'+run.run_attempt, source:'github-actions',
    project:scope.project, type:success?'task.updated':'ci.failed', severity:success?'info':'warning',
    timestamp, correlation_id:'run-'+runId,
    evidence_url:'https://github.com/'+scope.project+'/actions/runs/'+runId,
  }, now);
}
