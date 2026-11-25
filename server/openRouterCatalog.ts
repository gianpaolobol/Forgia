const api = 'https://openrouter.ai/api/v1';
type Transport = (url: string, init?: RequestInit) => Promise<Response>;
type Entry = Record<string, unknown>;

export class OpenRouterHttpError extends Error {
  constructor(path: string, status: number) {
    super(`OpenRouter ${path}: HTTP ${status}.`);
    this.status = status;
  }
  readonly status: number;
}

const brands: Record<string, string> = {
  openai: 'GPT', anthropic: 'Claude', moonshotai: 'Kimi', deepseek: 'DeepSeek',
  qwen: 'Qwen', nvidia: 'Nemotron', mistralai: 'Mistral', 'meta-llama': 'Llama',
  microsoft: 'Phi',
};

export const requestedFamilies = ['GPT', 'Claude', 'Gemini', 'Kimi', 'DeepSeek', 'Qwen',
  'Gemma', 'Nemotron', 'Mistral', 'Llama', 'Phi'] as const;

export function modelFamily(id: string) {
  const [publisher, slug] = id.split('/');
  if (publisher === 'google') {
    if (slug?.startsWith('gemini-')) return 'Gemini';
    if (slug?.startsWith('gemma-')) return 'Gemma';
  }
  return Object.hasOwn(brands, publisher) ? brands[publisher] : publisher;
}

function object(value: unknown): Entry {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Entry : {};
}

export function freeModelPricing(value: unknown): boolean {
  const pricing = object(value);
  return Object.hasOwn(pricing, 'prompt') && Object.hasOwn(pricing, 'completion') &&
    Object.values(pricing).every(price => price === 0 ||
      (typeof price === 'string' && /^0+(?:\.0+)?(?:e[+-]?\d+)?$/i.test(price)));
}

async function get(path: '/models' | '/key', transport: Transport, signal?: AbortSignal, apiKey?: string) {
  const timeout = AbortSignal.timeout(15_000);
  const response = await transport(api + path, {
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    ...(apiKey ? {headers: {Authorization: `Bearer ${apiKey}`}} : {}),
  });
  if (!response.ok) throw new OpenRouterHttpError(path, response.status);
  return object(await response.json()).data;
}

export async function openRouterCatalog(transport: Transport = fetch, signal?: AbortSignal) {
  const data = await get('/models', transport, signal);
  if (!Array.isArray(data)) throw Error('Catalogo OpenRouter non valido.');
  const models = data.map(object);
  const counts = new Map<unknown, number>();
  for (const {id} of models) counts.set(id, (counts.get(id) ?? 0) + 1);
  return models.flatMap(model => {
    const {id, pricing, context_length, supported_parameters} = model;
    if (typeof id !== 'string' || !/^[a-z0-9._-]+\/[a-z0-9._-]+:free$/i.test(id) ||
      counts.get(id) !== 1 || !freeModelPricing(pricing)) return [];
    const architecture = object(model.architecture);
    return [{
      id,
      family: modelFamily(id),
      contextTokens: Number.isSafeInteger(context_length) && Number(context_length) > 0 ? Number(context_length) : null,
      structuredOutput: Array.isArray(supported_parameters) && supported_parameters.includes('response_format'),
      textOutput: Array.isArray(architecture.output_modalities) && architecture.output_modalities.includes('text'),
    }];
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export async function openRouterKeyStatus(apiKey: string, transport: Transport = fetch) {
  if (!apiKey.trim()) throw Error('Impostare OPENROUTER_API_KEY nell’ambiente locale protetto.');
  const key = object(await get('/key', transport, undefined, apiKey));
  if (!Object.hasOwn(key, 'limit') || !Object.hasOwn(key, 'limit_reset')) {
    throw Error('Metadati della chiave OpenRouter incompleti.');
  }
  const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  return {
    limitUsd: amount(key.limit),
    remainingKeyLimitUsd: amount(key.limit_remaining),
    monthlyUsageUsd: amount(key.usage_monthly),
    reset: key.limit_reset === 'daily' || key.limit_reset === 'weekly' || key.limit_reset === 'monthly' ? key.limit_reset : null,
    monthlyLimit20UsdVerified: key.limit === 20 && key.limit_reset === 'monthly',
    accountBalanceUsd: null,
    automaticTopUp: null,
    remainingFreeRequests: null,
  };
}
