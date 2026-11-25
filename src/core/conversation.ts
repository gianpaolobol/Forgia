import {text, validateSpec, type AppSpec, type Project} from './spec.ts';

import {createBackedRepository, createRepository, type Storage} from './storage.ts';

export function createConversationRepository(store: Storage) {
  return createBackedRepository(store, 'forgia.conversations.v1', decodeConversations, JSON.stringify,
    async () => (await createRepository(store).load()).projects.map(fromProject));
}

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
  model?: string;
  requestId?: string;
}

export interface Conversation {
  id: string;
  name: string;
  turns: Turn[];
  spec?: AppSpec;
}

export function fromProject(project: Project): Conversation {
  return {
    id: project.id,
    name: project.spec.name,
    turns: [{role: 'user', text: project.spec.idea}],
    spec: project.spec,
  };
}

export function decodeConversations(value: string): Conversation[] {
  const rows: unknown = JSON.parse(value);
  if (!Array.isArray(rows)) throw Error('Conversazioni non valide.');
  const ids = new Set<string>();
  return rows.map(row => {
    const id = text(row?.id, 'Identificativo', 100);
    if (ids.has(id) || !Array.isArray(row.turns) || row.turns.length < 1 || row.turns.length > 200) {
      throw Error('Cronologia della conversazione non valida.');
    }
    ids.add(id);
    const turns = row.turns.map((turn: Turn): Turn => {
      if (turn?.role !== 'user' && turn?.role !== 'assistant') throw Error('Messaggio non valido.');
      return {role: turn.role, text: text(turn.text, 'Messaggio', 4000),
        ...(turn.model === undefined ? {} : {model: text(turn.model, 'Modello', 200)}),
        ...(turn.requestId === undefined ? {} : {requestId: text(turn.requestId, 'Identificativo del messaggio', 100)})};
    });
    return {id, name: text(row.name, 'Nome', 80), turns, ...(row.spec ? {spec: validateSpec(row.spec)} : {})};
  });
}

const services = [
  {name: 'Google', purpose: 'Configura l’accesso con Google o il servizio Google richiesto.', pattern: /\b(?:google (?:maps|cloud|drive|calendar|sheets)|(?:login|accedi|accesso|autenticazione) (?:con |tramite )?google)\b/i},
  {name: 'Apple', purpose: 'Configura Accedi con Apple o la distribuzione su App Store Connect.', pattern: /\b(?:accedi con apple|login (?:con )?apple|sign in with apple|testflight|app store(?: connect)?)\b/i},
  {name: 'Facebook', purpose: 'Configura l’integrazione Facebook.', pattern: /\bfacebook\b/i},
  {name: 'GitHub', purpose: 'Collega il repository richiesto.', pattern: /\bgithub\b/i},
  {name: 'Supabase', purpose: 'Collega il progetto backend richiesto.', pattern: /\bsupabase\b/i},
  {name: 'Firebase', purpose: 'Collega il progetto Firebase richiesto.', pattern: /\bfirebase\b/i},
  {name: 'Stripe', purpose: 'Configura l’integrazione Stripe richiesta.', pattern: /\bstripe\b/i},
  {name: 'Google Play Console', purpose: 'Configura la distribuzione Android.', pattern: /\b(?:google play|play store|play console)\b/i},
] as const;

export function requestedAccess(projects: Conversation[]) {
  return projects.flatMap(project => services.flatMap(({name, purpose, pattern}) => {
    const request = project.turns.filter(turn => turn.role === 'user').flatMap(turn =>
      turn.text.split(/[.!?;\n]+/).filter(sentence => pattern.test(sentence))).at(-1);
    const removed = request && /\b(?:senza|escludi|rimuovi|elimina|togli|non usare|non serve|non voglio|non collegare)\b/i.test(request);
    return request && !removed ? [{name, purpose, project: project.name, projectId: project.id}] : [];
  }));
}
