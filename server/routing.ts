import type {AppSpec} from '../src/core/spec.ts';
import {localProvider, type Provider} from './providers.ts';

export type RoutingContext = {kind: AppSpec['kind']; phase: 'draft' | 'revision'};
type Fit = {draft: number; revision: number; catalog: number; tracker: number; community: number; maxInputBytes?: number};

// Initial routing preferences, not measured model quality.
const defaults: Record<string, Fit> = {
  local: {draft: 2, revision: 3, catalog: 4, tracker: 1, community: 1},
  llamacpp: {draft: 2, revision: 3, catalog: 4, tracker: 1, community: 1},
  cloudflare: {draft: 3, revision: 3, catalog: 3, tracker: 2, community: 2},
  groq: {draft: 5, revision: 2, catalog: 4, tracker: 2, community: 2},
  openrouter: {draft: 2, revision: 8, catalog: 3, tracker: 5, community: 5},
};

export function parseFit(raw: string | undefined): Partial<Fit> {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Error('Profilo motore AI non valido.');
  }
  for (const [key, value] of Object.entries(parsed)) {
    const limit = key === 'maxInputBytes' ? 32000 : 10;
    if (!(Object.hasOwn(defaults.local, key) || key === 'maxInputBytes') ||
      typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > limit) {
      throw Error('Profilo motore AI non valido.');
    }
  }
  return parsed;
}

export function routingContext(kind: unknown, phase: unknown): RoutingContext {
  return {
    kind: kind === 'tracker' || kind === 'community' ? kind : 'catalog',
    phase: phase === 'revision' ? 'revision' : 'draft',
  };
}

export function rankProviders(providers: readonly Provider[], context: RoutingContext,
  prompt: string, cloudConsent: boolean, remaining: Readonly<Record<string, number>>, backlog = -1) {
  const bytes = Buffer.byteLength(prompt);
  const simple = context.kind === 'catalog' && context.phase === 'draft' && bytes <= 2000;
  const reserve = backlog >= 2 ? 8 : 4;
  return providers.flatMap(provider => {
    const base = defaults[provider.id];
    if (!base || !Object.hasOwn(defaults, provider.id) ||
        provider.mode !== (localProvider(provider.id) ? 'local' : 'free') ||
        (!cloudConsent && provider.mode !== 'local') ||
        !(remaining[provider.id] > (backlog >= 0 && simple && provider.mode === 'free' ? reserve : 0))) return [];
    const fit = {...base, ...provider.fit};
    if (fit.maxInputBytes !== undefined && bytes > fit.maxInputBytes) return [];
    const preference = backlog >= 0 && simple && provider.mode === "local" ? 12 : 0;
    const score = preference + fit[context.kind] * 2 + fit[context.phase] + Math.min(remaining[provider.id], 20) / 20;
    const kind = {catalog: 'catalogo', tracker: 'gestionale', community: 'gruppi ed eventi'}[context.kind];
    const phase = context.phase === 'revision' ? 'revisione' : 'prima bozza';
    const reason = `${kind}, ${phase}. ${provider.mode === 'local' ? 'Elaborazione locale.' : 'Quota gratuita disponibile.'}`;
    return [{provider, score, reason}];
  }).sort((a, b) => b.score - a.score || a.provider.id.localeCompare(b.provider.id));
}
