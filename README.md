# Forgia

> **Copyright © 2026 Gian Paolo Franceschini — All rights reserved for original proprietary contributions.** See [LICENSE.md](LICENSE.md). Third-party licenses and GitHub's permitted platform uses remain applicable.

Creatore di app di Gian Paolo Franceschini. Client Expo/React Native per iOS, Android e web; gateway di sviluppo Node separato. Nessun servizio a pagamento configurato.

## Già operativo
- Progetti locali, specifiche, revisioni con istruzione e ripristino senza cancellare la cronologia.
- Generatore **senza AI** di sorgenti Expo per cataloghi offline: dataset personalizzato, ricerca/categorie, preferiti, quiz opzionale sui colori e ripasso degli errori.
- ZIP esportabile dal web; percorso nativo di condivisione file implementato ma non provato su telefono.
- Recupero da backup e blocco dei dati corrotti, nessun messaggio di successo per scritture fallite.
- Gateway gratuito sostituibile: Ollama e llama.cpp in locale, Groq Free, OpenRouter :free e Cloudflare Workers AI Free. Quote/cache persistenti, consenso cloud, controlli prezzo e timeout. Inferenza reale verificata con llama.cpp e Qwen2.5-0.5B-Instruct.
- Proposte AI separate dai campi attuali e dai salvataggi; dataset esistente protetto per default. Nessun modello esegue comandi.
- Policy delle deleghe con permessi, scadenza, revoca, stato MFA e blocco totale dei pagamenti. OAuth, vault ed esecutore browser **non ancora integrati**.

## Demo con AI locale

Su Linux x86-64, con Node 24, npm, Python 3, curl e shasum disponibili, esegui
`bash scripts/demo-locale.sh`. Il primo avvio scarica llama.cpp e il modello Qwen
(469 MiB), verifica i checksum e avvia pannello, gateway e runtime su loopback.
Su macOS o altre architetture usa un `llama-server` già installato nel PATH
oppure indica il binario con `FORGIA_LLAMA_SERVER`.

Apri `http://127.0.0.1:8081` sullo stesso computer. Crea un progetto con nome e
idea, poi scegli **Avvia la chat**. La chat usa il motore configurato per
preparare la specifica. Le richieste per servizi riconosciuti compaiono in
**Accessi**. I cataloghi supportati si possono esportare dalla chat. Questa
demo usa solo il modello locale.

Su iOS e Android il microfono richiede le autorizzazioni del sistema e usa
il riconoscimento vocale sul dispositivo quando disponibile. La chat salva i
messaggi sul dispositivo. Per le risposte AI il client nativo può collegarsi al
[gateway HTTPS per tester](docs/PILOTA_MOBILE.md) in una build configurata.

## Avvio locale
Node 24 e npm. `npm ci`, poi `npm start` per il client oppure `npm run web`. `npm test` esegue le prove del dominio e del gateway; `npm run check` il controllo TypeScript; `npm run export:web` produce il pannello web statico.

Per il gateway locale: configurare soltanto le variabili necessarie dell'esempio in un file ignorato `.env`, poi `node --env-file=.env --experimental-strip-types server/main.ts`. Non inserire le chiavi nel client, nei prompt o nei file esportati. Nessun provider è attivo senza configurazione. Groq deve rimanere Free; la sola presenza di una chiave non permette di conoscere la fatturazione. Non collegare un piano a pagamento. Ollama deve usare un modello realmente locale e avere le funzioni cloud disabilitate nella propria installazione. Verificare modello e licenza prima di usarlo commercialmente.

Il gateway ascolta solo `127.0.0.1:8787` e accetta il client web locale sulle origini previste. **Non esporlo su Internet o tramite tunnel.** Nessuna autenticazione multiutente, vault o sandbox remota è stata consegnata. Nel pannello ospitato il gateway locale non è utilizzabile; il generatore offline resta disponibile. I progetti sono conservati nel browser/dispositivo, non sincronizzati nel cloud. Esportare per conservarne una copia; cancellare dati del browser o disinstallare elimina i dati locali.

## Collaudo su dispositivi

La [guida di collaudo](docs/COLLAUDO_NATIVO.md) descrive le build di prova e i passaggi da verificare. Gli identificativi iOS e Android usano `it.gianpaolofranceschini.forgia`.

## Stato delle verifiche
Leggere `docs/VERIFICHE_2026-11-11.md`. Bundle JS/Hermes per iOS e Android non sono IPA/AAB firmati. Non attestano installazione fisica, TestFlight, Play Store o comportamento nativo. I test browser automatici sono predisposti ma il lancio locale è bloccato dal sandbox; è stato eseguito un collaudo manuale attraverso il browser disponibile.

## Prossime consegne
Piano e roadmap: `docs/specs/2026-11-11-free-first.md`. Scelta API e architettura dell'autonomia: `docs/API_Gratuite_Autonomia_2026-11-11.md`. Il passo successivo è ampliare le prove sui modelli, attivare gli account cloud Free e completare il verticale C1 con build firmate e installazioni. Nessuna promessa di generazione universale o superiorità prestazionale è ancora dimostrata.

Non sono stati copiati sorgenti NativeBot/Vibra. Le dipendenze hanno le rispettive licenze. Il repository è pubblico. Per i contributi proprietari originali si applica LICENSE.md; restano valide le licenze di terzi.

## Identità visiva

La [guida grafica](docs/design/README.md) raccoglie le tavole e la scelta **B · Brace** per pulsanti e icone.

## Selezione automatica dei motori AI

Copia `.env.example` in `.env`, compila soltanto i motori che vuoi usare e
avvia il gateway con `node --env-file=.env --experimental-strip-types server/main.ts`.
Avvia poi `npm run web` e in **Motori AI** aggiorna i collegamenti.

| Motore | Configurazione |
| --- | --- |
| Ollama | Avvia Ollama su `127.0.0.1:11434`, scarica un modello locale e imposta `OLLAMA_MODEL`. |
| llama.cpp | Avvia `llama-server -m /percorso/modello.gguf --alias forgia-local --host 127.0.0.1 --port 8080` e imposta `LLAMACPP_MODEL=forgia-local`. |
| Groq | Imposta modello e chiave di un account Free. Abilita `GROQ_FREE_PLAN_CONFIRMED=true` solo dopo aver verificato il piano senza fatturazione. |
| OpenRouter | Imposta chiave e ID di un modello con suffisso `:free`. Il gateway controlla i prezzi dichiarati prima dell'inferenza. |
| Cloudflare | Imposta ID account, token Workers AI e `CLOUDFLARE_MODEL=@cf/meta/llama-3.1-8b-instruct`. Abilita `CLOUDFLARE_FREE_PLAN_CONFIRMED=true` solo su Workers Free. Mantieni l'account sul piano Free. |

I piani dei provider sono verificati dall'operatore per Groq e Cloudflare.
Le chiavi restano nel gateway e `.env` è escluso da Git.

In **Scelta automatica**, le prime bozze semplici privilegiano i modelli
locali. Famiglia, fase, dimensione, quota residua e lavori in attesa
determinano i candidati. Forgia permette 20 richieste al giorno per ciascun
motore cloud. Protegge le ultime 4 richieste per le operazioni più
complesse, oppure le ultime 8 quando ci sono almeno due lavori in attesa.
I motori locali dipendono da memoria, velocità e modello installato.
I profili iniziali si possono calibrare via `*_FIT` con punteggi da 1 a 10
per `catalog`, `tracker`, `community`, `draft`, `revision` e un
eventuale `maxInputBytes` da 1 a 32000.

La coda locale usa un solo worker e alterna le sessioni del pannello quando
possibile. Accetta fino a 16 lavori attivi, fino a 3 per sessione. Al
riavvio riprende i lavori in attesa e segnala quello interrotto. Conserva
fino a 32 esiti locali. Il pannello mostra lo stato durante la sessione
corrente. L'eventuale passaggio al cloud richiede il consenso. Se nessun
motore compatibile risponde, il lavoro restituisce un errore e può essere
riprovato. I modelli propongono specifiche da approvare. L'export di
sorgenti Expo è disponibile per i cataloghi.

## Coda SQLite sperimentale (solo loopback, solo AI locali)
Sul candidato F05-L: arrestare TUTTI i gateway e fare copia offline della directory dati. Su installazione di prova privata, avviare con `FORGIA_SQLITE_LOCAL=1 FORGIA_SQLITE_INITIALIZE=1 npm run api` (sintassi shell POSIX). Rimuovere INITIALIZE ai riavvii. Il file jobs.v1 originale rimane intatto; la modalità normale rifiuta la presenza della directory sqlite-loopback. Non cancellarla per tornare al JSON: serve riconciliazione offline dei nuovi job. Non usare su dati di produzione; nessun cloud, LAN o TLS pilota in questa modalità. Conservare DB e WAL con backup coerente; ACL Windows da verificare prima del collaudo Windows. L'esito incerto non viene ripetuto dal worker. Vedi piano e progress per test e limiti.

Per collaudo isolato: `node scripts/test-durable-loopback.mjs` (porte 8787 e 11434 libere; usa server fixture, non un vero modello). Il loopback è un confine fidato, non autenticazione multiutente. Se manca il marker di migrazione al riavvio, il sistema rifiuta l'avvio: ripristinare una copia coerente offline; non inizializzare sopra dati preesistenti.


### Pilota SQLite loopback — stato quota/cache (candidato, non release)
Il ramo di integrazione prepara anche il registro quote e la cache SQLite senza abilitare i provider cloud. Solo dopo migrazione esplicita e verificata della coda locale: arrestare **tutti** i processi gateway/worker legacy, conservare backup offline dell'intera directory dati (inclusi eventuali sidecar SQLite, a processi arrestati), verificare `gateway.v1.json` presente e integro. In ambiente di collaudo, con `FORGIA_SQLITE_LOCAL=1` già operativo e senza `FORGIA_SQLITE_INITIALIZE`, impostare `FORGIA_SQLITE_CLOUD_STATE=1` e una sola volta `FORGIA_SQLITE_CLOUD_INITIALIZE=1`. Ai successivi avvii rimuovere il flag INITIALIZE e mantenere STATE. Snapshot assente, DB mancante/corrotto o bootstrap duplicato bloccano l'avvio; non cancellare né ricreare gli archivi per aggirare il blocco. Non esporre il gateway. ACL Windows, test HTTP estesi, revoca e sospensione 429 ancora da verificare: non usare con dati reali o abilitare cloud prima del collaudo e della revisione.

### Sospensione quota durevole (candidato R09)
Il candidato su SQLite mantiene lo stesso ID dei job con rifiuto quota esplicito, esponendo `status: queued` e `nextEligibleAt` (millisecondi Unix). Il percorso sincrono /plan restituisce 429 con ID e scadenza; usare /jobs/{id} per seguire il lavoro. Non inviare nuovamente lo stesso lavoro con un'altra chiave. Due riprese automatiche al massimo, sempre dopo nuova autorizzazione e verifica quota. Gli esiti incerti non vengono ripetuti. Prima di collaudare aggiornamenti fare backup offline di tutto il DB: non riavviare binari precedenti sullo stesso archivio (non riconoscono la tabella delle sospensioni). Cloud resta disabilitato in modalità SQLite. La UI non è ancora verificata per ripresa dopo reload.

## Master Portfolio Orchestrator

[Import del piano, backlog e catalogo OpenRouter](docs/MASTER_PORTFOLIO.md).


### Revoca dei tester (candidato F08/R03)
Il pilota HTTPS preesistente associa ogni lavoro alla specifica autorizzazione (identità, impronta del token e scadenza); nessun token in chiaro viene scritto nella coda. Al dispatch e prima del risultato rilegge la lista dei tester; durante l'esecuzione verifica periodicamente e annulla al primo diniego rilevato. Gli invii già effettuati non sono reversibili; una revoca transitoria fra due controlli potrebbe non essere osservata. Cambiare token o scadenza crea un nuovo grant: i job/cache precedenti non sono riutilizzati. Prima dell'aggiornamento arrestare i gateway e conservare backup offline dei dati del pilota: i job legacy senza grant non saranno accessibili o rieseguiti dal nuovo pilota. Il candidato non attiva HTTPS, LAN o cloud, non è un backend multiutente e non amplia l'accesso SQLite oltre loopback. Collaudo HTTPS e revisione ancora pendenti.


### Registro dei profili AI (candidato F03)
Variabile server opzionale `FORGIA_MODEL_REGISTRY` con JSON, ad esempio `{"local":{"active":"small","profiles":[{"id":"small","model":"qwen2.5:0.5b","fit":{"draft":5}},{"id":"large","model":"qwen2.5:3b"}]}}`. Se assente, restano le variabili legacy. Arrestare il gateway prima di cambiare `active`; un solo profilo per adapter è attivo. Modelli installati e licenze da verificare separatamente. Il fit del profilo prevale su `_FIT` se presente; il provider ID resta invariato per quote e routing, la cache rimane distinta per modello. `/providers` indica il profilo attivo, non le credenziali. Configurazione invalida rifiutata; il registro non accetta endpoint, credenziali, ID provider aggiuntivi o modifiche alle quote. I controlli preesistenti di consenso, account Free e verifica prezzo restano obbligatori. Il candidato SQLite resta loopback e solo locale; non usare il registro per aggirare limiti o attivare provider non autorizzati. Nessun hot reload, nuovo adapter o nuovo nodo remoto consegnato da questo incremento.


### Coordinatore Superhandy locale (candidato F06/F07)
Il comando `node --experimental-strip-types scripts/superhandy.ts` gestisce un archivio SQLite per piano sotto `FORGIA_DATA_DIR/superhandy` (default `.data`). La directory dati deve esistere ed essere privata (0700 Linux). Un archivio nuovo si crea con `init <archivio> <piano.json>`; non sovrascrivere o ricreare un archivio esistente. Il JSON accetta soltanto project, planner, reviewer, executors (lista ID) e tasks (lista di id, depends, criterion). ID minuscoli alfanumerici con trattino/underscore, reviewer distinto dal planner e da tutti gli esecutori. I task dipendenti partono dopo accettazione delle dipendenze.

Comandi successivi (dopo nome archivio): `approve <reviewer> <baselineSha> <evidenceSha256>`, `claim <executor>`, `heartbeat <leaseJSON> <ttlMs>`, `dispatch <leaseJSON>`, `handoff <leaseJSON> <checkpointSha256>` (solo prima del dispatch), `submit <leaseJSON> <deliverableSha256>`, `review <reviewer> <taskId> <deliverableSha256> <accept|reject> <reviewEvidenceSha256>`, `inspect`. Copiare soltanto l'oggetto lease restituito dal claim; null significa nessun task assegnabile. Lease 60 s di default, heartbeat fino a 300 s; scadenza dopo dispatch implica esito incerto e nessun replay automatico. Il ledger non esegue comandi né modelli: l'operatore locale fidato registra eventi e hash, senza segreti nei piani. Il bridge locale descritto sotto aggiunge soltanto la generazione di specifiche tramite gateway. Non simulare approvazioni indipendenti, non esporre via HTTP, non usarlo per utenti multipli. ACL Windows, integrazione agenti/UI e RV-01 da collaudare. 

### Superhandy: generazione locale di specifiche e recupero

Avviare il gateway SQLite loopback già inizializzato con il proprio modello locale configurato. Dopo aver creato e approvato la baseline, usare `node --experimental-strip-types scripts/superhandy.ts run-local-spec <archivio> <executor> <taskId> <local|llamacpp>`. Selezionare esclusivamente un task il cui criterio è il prompt per una specifica di app; nessun codice generato è eseguito. L'operazione usa la coda gateway esistente e il modello locale esplicito, senza consenso cloud, con sessione distinta. Il preflight verifica configurazione, non disponibilità effettiva del modello. L'esito submitted richiede ancora review da parte del reviewer della baseline. Il bridge conserva intento, ricevuta e risultato JSON privati nella directory `<FORGIA_DATA_DIR>/superhandy/<archivio>-artifacts`, legando gli hash di intento e ricevuta al ledger; il risultato è validato e hashato prima della consegna.

Se il gateway sospende il lavoro o la CLI si interrompe dopo aver registrato la ricevuta, usare `node --experimental-strip-types scripts/superhandy.ts resume-local-spec <archivio> <executor> <taskId>`: effettua solo GET sul job originale, anche dopo scadenza del lease, senza reinvio del prompt. Se la ricevuta manca o non è legata al registro, non ripetere: occorre verifica manuale. Nessun recupero automatico per esiti sconosciuti senza ricevuta, nessuna identità autenticata o revoca in-flight del bridge, nessuna shell o esposizione nuova. Il bridge è per un operatore locale fidato; non è un gateway remoto. Su Windows occorrono verifica ACL e collaudo dedicati. 

Test separato `node scripts/test-superhandy-loopback.mjs` (porta 8787 libera): CLI reali, SQLite e HTTP con gateway sintetico. `node scripts/test-durable-loopback.mjs` (porte 8787/11434 libere) contiene anche l'integrazione main effettivo e adapter locale con modello sintetico; questa estensione è ancora da eseguire sul candidato completo. Non equivale a collaudo di inferenza reale.
