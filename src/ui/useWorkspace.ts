import {useEffect, useMemo, useRef, useState} from 'react';
import {Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {text, validateSpec} from '../core/spec';
import {createConversationRepository, requestedAccess, type Conversation} from '../core/conversation';
import {generateProject} from '../core/generator';
import {exportBundle} from './export';

export type Page = 'home' | 'new' | 'detail' | 'engines' | 'access' | 'method';
const localAPI = 'http://127.0.0.1:8787';
const configuredPilot = process.env.EXPO_PUBLIC_FORGIA_PILOT_URL?.trim().replace(/\/$/, '');
const pilotAPI = configuredPilot && /^https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(configuredPilot)
  ? configuredPilot : undefined;

async function gatewayRequest(url: string, options: RequestInit, timeout: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {...options, signal: controller.signal, redirect: 'error'});
    return {response, body: await response.json()};
  } finally {
    clearTimeout(timer);
  }
}
const conversations = createConversationRepository(AsyncStorage);
const id = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Operazione non riuscita.';

export function useWorkspace() {
  const [page, setPage] = useState<Page>('home');
  const [projects, setProjects] = useState<Conversation[]>([]);
  const [current, setCurrent] = useState<string>();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobStatus, setJobStatus] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [idea, setIdea] = useState('');
  const [note, setNote] = useState('');
  const [providers, setProviders] = useState<{id: string; model: string; configured: boolean}[]>([]);
  const [selected, setSelected] = useState('auto');
  const [consent, setConsent] = useState(false);
  const [testerCode, setTesterCode] = useState('');
  const nativePilot = Platform.OS !== 'web' && !!pilotAPI;
  const api = Platform.OS === 'web' ? localAPI : pilotAPI;
  const [engineNote, setEngineNote] = useState('Nessun motore AI collegato');
  const session = useRef<string | undefined>(undefined);
  const locked = useRef(false);
  const saved = useRef<Conversation[]>([]);
  const project = projects.find(row => row.id === current);
  const access = useMemo(() => requestedAccess(projects), [projects]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const {projects: rows, recovered} = await conversations.load();
        if (active) {
          saved.current = rows;
          setProjects(rows);
          setReady(true);
          if (recovered) setError('Ultimo salvataggio integro recuperato.');
        }
      } catch (cause) {
        if (active) setError(errorText(cause));
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  function go(next: Page) { setError(''); setPage(next); }
  function start() { setName(''); setIdea(''); go('new'); }
  function open(projectId: string) { setCurrent(projectId); setNote(''); go('detail'); }

  async function persist(row: Conversation) {
    const next = [row, ...saved.current.filter(item => item.id !== row.id)];
    await conversations.save(next);
    saved.current = next;
    setProjects(next);
  }

  function credentials(): Record<string, string> {
    if (Platform.OS === 'web') return {};
    const code = testerCode.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(code)) throw Error('Inserisci il codice tester in Motori AI.');
    return {Authorization: 'Bearer ' + code};
  }

  async function readProviders() {
    if (!api) throw Error('Gateway AI mobile non configurato per questa build.');
    const {response, body: data} = await gatewayRequest(api + '/providers', {headers: credentials()}, 4000);
    if (!response.ok) throw Error(data.error ?? 'Gateway AI non raggiungibile.');
    const available: typeof providers = data.providers.filter((item: typeof providers[number]) => item.configured);
    setProviders(available);
    setEngineNote(available.length ? (nativePilot ? 'Gateway pilota collegato' : 'Gateway locale collegato') : 'Nessun motore AI collegato');
    return available;
  }

  async function refreshEngines() {
    setError('');
    try { await readProviders(); }
    catch (cause) { setProviders([]); setEngineNote('Nessun motore AI collegato'); setError(errorText(cause)); }
  }

  async function askAI(row: Conversation) {
    if (!api) return;
    setJobStatus('Collegamento al motore AI…');
    if (!nativePilot) {
      const available = await readProviders();
      if (!available.some(item => selected === 'auto' || item.id === selected)) {
        throw Error('Collega un motore nella sezione Motori AI e riprova dalla chat.');
      }
    }
    const last = row.turns[row.turns.length - 1];
    const requestId = last.requestId ?? id();
    if (nativePilot && !last.requestId) {
      row = {...row, turns: [...row.turns.slice(0, -1), {...last, requestId}]};
      await persist(row);
    }
    const history = row.turns.slice(-4, -1).map(turn => ({role: turn.role, text: turn.text.slice(0, 160)}));
    const currentSpec = row.spec && {kind: row.spec.kind, quiz: row.spec.quiz, items: row.spec.items.slice(0, 8),
      idea: row.spec.idea.slice(0, 250)};
    const prompt = JSON.stringify({name: row.name, recent: history.length ? history : undefined,
      current: currentSpec, instruction: last.text});
    const boundedPrompt = prompt.length <= 8000 ? prompt : JSON.stringify({
      name: row.name, current: currentSpec && {kind: currentSpec.kind, idea: currentSpec.idea},
      instruction: last.text,
    });
    if (boundedPrompt.length > 8000) throw Error('Il messaggio è troppo lungo per il motore. Dividilo in più messaggi.');
    if (!nativePilot) session.current ||= globalThis.crypto.randomUUID();
    const authorization = credentials();
    const {response, body: receipt} = await gatewayRequest(api + '/jobs', {
      method: 'POST',
      headers: {...authorization, 'Content-Type': 'application/json',
        ...(nativePilot ? {'Idempotency-Key': encodeURIComponent(row.id) + ':' + requestId} : {})},
      body: JSON.stringify({session: session.current, idea: boundedPrompt, provider: selected,
        cloudConsent: consent, kind: row.spec?.kind, phase: row.spec ? 'revision' : 'draft'}),
    }, 8000);
    if (!response.ok) throw Error(receipt.error ?? 'Richiesta AI non riuscita.');
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      const {response: status, body: job} = await gatewayRequest(api + '/jobs/' + encodeURIComponent(receipt.id),
        {headers: authorization}, 8000);
      if (!status.ok || job.status === 'failed') throw Error(job.error ?? 'Elaborazione non riuscita.');
      if (job.status === 'done') {
        const proposed = validateSpec(job.result.spec);
        const items = row.spec?.items.length
          ? [...row.spec.items, ...proposed.items.filter(candidate => !row.spec?.items.some(
            existing => existing.name.toLocaleLowerCase('it') === candidate.name.toLocaleLowerCase('it')))]
          : proposed.items;
        const spec = validateSpec({...proposed, name: row.name, kind: row.spec?.kind ?? proposed.kind, items, quiz: row.spec?.quiz ?? proposed.quiz});
        await persist({...row, spec, turns: [...row.turns, {role: 'assistant', text: spec.idea, model: job.result.routing?.model}]});
        return;
      }
      setJobStatus(job.status === 'queued' ? 'Richiesta in coda…' : 'Il motore sta elaborando…');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw Error('L’elaborazione sta richiedendo troppo tempo. L’idea è salvata.');
  }

  async function run(action: () => Promise<void>) {
    if (locked.current || !ready) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (cause) { setError(errorText(cause)); }
    finally { locked.current = false; setBusy(false); setJobStatus(''); }
  }

  function create() {
    return run(async () => {
      const row: Conversation = {id: id(), name: text(name, 'Nome', 80),
        turns: [{role: 'user', text: text(idea, 'Idea', 4000), requestId: id()}]};
      await persist(row);
      open(row.id);
      await askAI(row);
    });
  }

  function send() {
    if (!project) return;
    return run(async () => {
      const row: Conversation = {...project, turns: [...project.turns, {role: 'user', text: text(note, 'Messaggio', 4000), requestId: id()}]};
      await persist(row);
      setNote('');
      await askAI(row);
    });
  }

  function retry() {
    if (project?.turns.at(-1)?.role === 'user') return run(() => askAI(project));
  }

  async function download() {
    if (project?.spec?.kind !== 'catalog') return;
    try { await exportBundle(generateProject(project.spec)); }
    catch (cause) { setError(errorText(cause)); }
  }

  return {page, projects, project, ready, busy, jobStatus, error, name, setName, idea, setIdea, note, setNote,
    providers, selected, setSelected, consent, setConsent, engineNote, access, go, start, open, create, send,
    retry, download, refreshEngines, liveAI: !!api, nativePilot, testerCode, setTesterCode};
}

export type Workspace = ReturnType<typeof useWorkspace>;
