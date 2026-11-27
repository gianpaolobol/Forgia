import {useEffect, useMemo, useRef, useState} from 'react';
import {Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {text, validateSpec} from '../core/spec';
import {createConversationRepository, requestedAccess, type Conversation} from '../core/conversation';
import {lanPilotOrigin, pilotConnection} from '../core/lanPilot';
import {closeJob, decodeJobRecovery, recoveryAction, type JobRecovery} from '../core/jobRecovery';
import {receiptLookupHeaders} from '../core/receiptLookup';
import {localWebAuth, verifyLocalWebMode, verifyLocalWebRecovery} from '../core/localWebAuth';
import {generateProject} from '../core/generator';
import {exportBundle} from './export';

export type Page = 'home' | 'new' | 'detail' | 'engines' | 'access' | 'method';
// Expo only inlines direct EXPO_PUBLIC_* property access.
const pilotProfile = (editable?: string) => pilotConnection(Platform.OS,
  process.env.EXPO_PUBLIC_FORGIA_IOS_LAN_PILOT,
  process.env.EXPO_PUBLIC_FORGIA_ANDROID_LAN_PILOT,
  process.env.EXPO_PUBLIC_FORGIA_PILOT_URL, editable);

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
  const [localAccount, setLocalAccount] = useState('');
  const [localCode, setLocalCode] = useState('');
  const webLocal = Platform.OS === 'web';
  const [pilotAddress, setPilotAddress] = useState(() => pilotProfile().initialAddress ?? '');
  const {nativePilot, iosLanPilot, api} = pilotProfile(pilotAddress);
  const [engineNote, setEngineNote] = useState('Nessun motore AI collegato');
  const session = useRef<string | undefined>(undefined);
  const recoveredStorage = useRef(false);
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
          recoveredStorage.current = recovered;
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

  function changePilotAddress(value: string) {
    if (lanPilotOrigin(value) !== lanPilotOrigin(pilotAddress)) {
      setTesterCode('');
      setProviders([]);
      setEngineNote('Nessun motore AI collegato');
    }
    setPilotAddress(value);
  }

  function changeLocalCredential(field:'account'|'code', value:string) {
    if(locked.current)return;
    if(field==='account')setLocalAccount(value);else setLocalCode(value);
    setProviders([]);setEngineNote('Nessun motore AI collegato');
  }

  function credentials(): Record<string, string> {
    if (webLocal) return localWebAuth(api,localAccount,localCode)?.headers ?? {};
    const code = testerCode.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(code)) throw Error('Inserisci il codice tester in Motori AI.');
    return {Authorization: 'Bearer ' + code};
  }

  async function readProviders() {
    if (!api) throw Error(iosLanPilot ? 'Inserisci l’indirizzo HTTPS del gateway pilota sulla rete locale.' : 'Gateway AI mobile non configurato per questa build.');
    const {response, body: data} = await gatewayRequest(api + '/providers', {headers: credentials()}, 4000);
    if (!response.ok) throw Error(data.error ?? 'Gateway AI non raggiungibile.');
    if(webLocal)verifyLocalWebMode(data,localWebAuth(api,localAccount,localCode));
    const available: typeof providers = data.providers.filter((item: typeof providers[number]) => item.configured);
    setProviders(available);
    setEngineNote(available.length ? (nativePilot ? 'Gateway pilota collegato' : 'Gateway locale collegato') : 'Nessun motore AI collegato');
    return available;
  }

  async function refreshEngines() {
    return run(async()=>{
      try { await readProviders(); }
      catch (cause) { setProviders([]); setEngineNote('Nessun motore AI collegato'); throw cause; }
    });
  }

  async function askAI(row: Conversation) {
    if (!api) return;
    const origin = api;
    const last = row.turns[row.turns.length - 1];
    const localAuth=webLocal ? localWebAuth(origin,localAccount,localCode) : undefined;
    if(webLocal)verifyLocalWebRecovery(last.job,localAuth);
    const action = recoveryAction(last.job, origin);
    const lookupHeaders = receiptLookupHeaders(last.job,origin,row.id,last.requestId);
    if (action === 'blocked' && !lookupHeaders) throw Error('Richiesta già avviata, chiusa o appartenente a un altro gateway. Nessun nuovo invio automatico.');
    let jobId: string;
    const authorization = credentials();
    if(localAuth && action!=='submit')await readProviders();

    async function saveJob(job: JobRecovery) {
      row = {...row, turns:[...row.turns.slice(0,-1), {...row.turns[row.turns.length-1],job}]};
      await persist(row);
    }

    if (action === 'poll' && last.job?.state === 'accepted') {
      jobId = last.job.id;
    } else if (lookupHeaders && last.job?.state === 'submitting') {
      setJobStatus('Ricerca della ricevuta originale…');
      const {response,body:receipt} = await gatewayRequest(origin+'/jobs/receipt',{method:'GET',headers:{...lookupHeaders,...authorization}},8000);
      if (!response.ok) throw Error('Ricevuta non trovata o gateway non compatibile. Nessun reinvio automatico.');
      const accepted = decodeJobRecovery({...last.job,state:'accepted',id:receipt.id});
      if (accepted.state !== 'accepted') throw Error('Ricevuta non valida.');
      jobId = accepted.id;
      await saveJob(accepted);
    } else {
      setJobStatus('Collegamento al motore AI…');
      if (!nativePilot) {
        const available = await readProviders();
        if (!available.some(item => selected === 'auto' || item.id === selected)) {
          throw Error('Collega un motore nella sezione Motori AI e riprova dalla chat.');
        }
      }
      const requestId = last.requestId ?? id();
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
      if (!nativePilot && !localAuth) session.current ||= globalThis.crypto.randomUUID();
      const requestSession = nativePilot ? undefined : localAuth?.session ?? session.current;
      const context = {origin, ...(nativePilot ? {} : {session:requestSession}), ...(localAuth ? {protectedLocal:true} : {})};
      const marker = decodeJobRecovery({...context,state:'submitting'});
      row = {...row, turns:[...row.turns.slice(0,-1), {...last,requestId}]};
      // The marker MUST be durable before dispatch. A lost receipt is ambiguous:
      // do not repeat the POST, including against legacy queues without deduplication.
      await saveJob(marker);
      const {response, body: receipt} = await gatewayRequest(origin + '/jobs', {
        method:'POST',
        headers:{...authorization,'Content-Type':'application/json',
          'Idempotency-Key':encodeURIComponent(row.id)+':'+requestId},
        body:JSON.stringify({session:requestSession, idea:boundedPrompt, provider:selected,
          cloudConsent:localAuth ? false : consent, kind:row.spec?.kind, phase:row.spec?'revision':'draft'}),
      },8000);
      if (!response.ok) throw Error(receipt.error ?? 'Richiesta non confermata: nessun reinvio automatico.');
      const accepted = decodeJobRecovery({...context,state:'accepted',id:receipt.id});
      if (accepted.state !== 'accepted') throw Error('Ricevuta non valida.');
      jobId = accepted.id;
      await saveJob(accepted);
    }

    const deadline = Date.now()+300000;
    while (Date.now()<deadline) {
      const {response:status,body:job} = await gatewayRequest(origin+'/jobs/'+encodeURIComponent(jobId),
        {headers:authorization},8000);
      if (!status.ok) throw Error(job.error ?? 'Ricevuta non accessibile. Verifica il gateway e le autorizzazioni; nessun reinvio.');
      if (job.status === 'failed') {
        const marker = row.turns.at(-1)?.job;
        if (marker) await saveJob(closeJob(marker));
        throw Error(job.error ?? 'Elaborazione non riuscita.');
      }
      if (job.status === 'done') {
        const proposed = validateSpec(job.result.spec);
        const items = row.spec?.items.length
          ? [...row.spec.items, ...proposed.items.filter(candidate => !row.spec?.items.some(
            existing => existing.name.toLocaleLowerCase('it') === candidate.name.toLocaleLowerCase('it')))]
          : proposed.items;
        const spec = validateSpec({...proposed, name:row.name, kind:row.spec?.kind??proposed.kind, items, quiz:row.spec?.quiz??proposed.quiz});
        await persist({...row,spec,turns:[...row.turns,{role:'assistant',text:spec.idea,model:job.result.routing?.model}]});
        return;
      }
      if (job.status !== 'queued' && job.status !== 'running') throw Error('Stato del lavoro non riconosciuto.');
      if (job.status === 'queued' && Number.isFinite(job.nextEligibleAt) && job.nextEligibleAt > Date.now()) {
        throw Error('Lavoro sospeso per quota fino a '+new Date(job.nextEligibleAt).toLocaleString('it-IT')+'. Riprendi dalla ricevuta senza reinvio.');
      }
      setJobStatus(job.status === 'queued' ? 'Richiesta in coda…' : 'Il motore sta elaborando…');
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw Error('L’elaborazione continua sul gateway. Riprendi dalla ricevuta salvata.');
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
    if (!project || (project.turns.at(-1)?.job && project.turns.at(-1)?.job?.state !== 'closed' && project.turns.at(-1)?.role === 'user')) return;
    return run(async () => {
      const row: Conversation = {...project, turns: [...project.turns, {role: 'user', text: text(note, 'Messaggio', 4000), requestId: id()}]};
      await persist(row);
      setNote('');
      await askAI(row);
    });
  }

  function retry() {
    if (project?.turns.at(-1)?.role !== 'user') return;
    return run(async () => {
      if (recoveredStorage.current && !project.turns.at(-1)?.job) throw Error('Archivio recuperato da backup: esito precedente non verificabile. Scrivi un nuovo messaggio solo dopo aver controllato il gateway.');
      await askAI(project);
    });
  }

  function abandonJob() {
    const last = project?.turns.at(-1);
    if (!project || last?.role !== 'user' || !last.job || last.job.state === 'closed') return;
    const job = closeJob(last.job);
    return run(() => persist({...project,turns:[...project.turns.slice(0,-1),{...last,job}]}));
  }

  async function download() {
    if (project?.spec?.kind !== 'catalog') return;
    try { await exportBundle(generateProject(project.spec)); }
    catch (cause) { setError(errorText(cause)); }
  }

  return {page, projects, project, ready, busy, jobStatus, error, name, setName, idea, setIdea, note, setNote,
    providers, selected, setSelected, consent, setConsent, engineNote, access, go, start, open, create, send,
    retry, abandonJob, download, refreshEngines, liveAI: !!api,
    canLookupReceipt: !!(api && project && receiptLookupHeaders(project.turns.at(-1)?.job,api,project.id,project.turns.at(-1)?.requestId)), nativePilot, iosLanPilot, pilotAddress, changePilotAddress, testerCode, setTesterCode, webLocal, localAccount, localCode, changeLocalCredential};
}

export type Workspace = ReturnType<typeof useWorkspace>;
