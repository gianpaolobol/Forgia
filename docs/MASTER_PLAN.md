# Forgia V1.0 — piano maestro v0.14
Data: 2026-11-24. Stato: proposta, NON approvata da revisore indipendente. Revisore logico previsto: RV-01; identità/modello/sessione da registrare all'assegnazione. Non equiparare questo autore a un secondo agente. La baseline resta da revisionare; in modalità C sono consentite implementazioni reversibili su branch isolati, senza approvazione definitiva.

## Inventario verificato su GitHub
Main: f8e64a98a37d4f40177ea0bbb13006db93ee874e. PR #6 iniziale di questa iterazione: 8514984d7aa4c9c7e57de31fc80d1507b3c1a49e. Letti AGENTS, README, CONTINUITA, specifica free-first, package.json, rapporto verifiche, diff PR #6, elenco file PR #1–5, routing/jobs del ramo #4 e specifica #5. Inventario sorgenti completo ancora da fare.
- Main: Expo/RN, generatore cataloghi offline, revisioni, ZIP, gateway locale, policy deleghe. Rapporto storico 35 test; nessuna inferenza reale su main, nessuna installazione fisica attestata.
- #1 feat/selezione-motori-ai ca211649: 35 file, non mergeable al momento; adapters, routing e jobs già presenti nel ramo. La descrizione dichiara 44 test e demo locale Qwen, non riverificati in questa iterazione.
- #2 fix/recupero-conversazioni dd891389 su #1: ripristino conversazioni; #3 feat/gateway-mobile 6992cfbf su #2: HTTPS pilota, isolamento; #4 feat/pilota-windows-lan fed1b414 su #3: kit Windows e LAN. Le dichiarazioni storiche dei test non sono nuove prove. Non ricostruire questi moduli da zero e non integrare #2–4 isolatamente.
- #5 feature/remote-control 502880bc su main: specifica, non implementazione. Remote control separato da gateway loopback.
- #6 setup/multi-agent-orchestration: policy e workflow, nessun run PR o status riportato sullo SHA iniziale, nessuna review.
- Routing #4 usa ID/funzioni hardcoded, coda #4 serializzata nel singolo processo: i job running al riavvio diventano failed. Non sono registry dinamico, lease multi-worker o orchestrazione Superhandy.
- Expo Node 24; npm ci, npm test, npm run check, npm run export:web, npm run test:ui. Nessuna quota o credenziale attiva provata in questa iterazione.

## Vincoli e gate
Budget nuovo zero; niente piani/runner a pagamento, quote aggirate, segreti in repository pubblico/client, invio dati senza consenso, gateway esposto, shell arbitraria da HTTP, push diretto main o pubblicazioni store non autorizzate. Il progetto non è pronto alla V1.0. Ruoli logici distinti da agenti realmente indipendenti. Ogni task: ID, base SHA, file, criteri, evidenze, review del piano RV-01 e dell'esito dallo stesso revisore, handoff e PR. Se revisore non disponibile, lascia gate aperto. Ammesse solo misure conservative di quarantena prima della review, nessuna attivazione di provider.
## Task e matrice requisito–test–evidenza
Stato iniziale: aperto salvo inventario parziale. Ogni riga ha dipendenze, deliverable e test di accettazione. Evidenza richiesta: SHA, comando, risultato, log/artifact redatto e revisore; non basta un check senza run.
| ID | Dipende | Deliverable | Test di accettazione | Priorità |
|---|---|---|---|---|
| F00 | — | Inventario PR e baseline versionata, review RV-01 | ogni requisito mappato, conflitti/dipendenze espliciti, review firmata e ripetibile | P0 |
| F01 | F00 | Quarantena e hardening PR #6, autenticazione con input ufficiale, pin, minimo privilegio | nessuna esecuzione finché gate chiuso; owner-only; nessun write/token a modello; lint; prova gratuita su repo pubblico autorizzato; output/handoff separato | P0 |
| F02 | F00 | Consolidamento #1–4 impilate e #5, confronto main, integrazione conservativa | risolvere conflitto #1; preservare correzione backup; npm ci/test/check e build per SHA finale; matrice feature; autorizzazione merge | P0 |
| F03 | F02 | Registry provider/modello/runtime/agente e adapter contract | aggiungere provider senza cambiare router; schema validato; duplicati/ID invalidi; compatibilità adapter esistenti; niente segreti nel registry | P1 |
| F04 | F03 | Routing per capacità, contesto, quota, costo, consenso, privacy, risorse e benchmark | determinismo; unknown/paid/429 esclusi; locale per riservato; quote atomiche; nessun candidato => coda; motivazioni verificabili | P1 |
| F05 | F02,F03 | SQLite o persistenza transazionale equivalente, migrazione e lease con fencing | 2 worker, restart, lease scaduto, crash tra side effect e commit, idempotenza su payload e sessione, limiti e cancellazione, niente replay effetti incerti | P1 |
| F06 | F04,F05 | Superhandy state machine e baseline immutabile, task DAG, reviewer continuity | cicli DAG rifiutati; nessuna esecuzione prima di review; reviewer originale o sostituzione esplicita; esecutore non autoapprova; revisioni riaprono task; audit duraturo | P1 |
| F07 | F03,F04,F06 | Adapter autorizzati Claude/Codex/Gemini e runtime locali, separare chat da strumenti | contract suite; autenticazione e quote osservate; mock vs reale espliciti; tool rights minimi; handoff limitato; nessun retry indiscriminato | P1 |
| F08 | F05,F06,F07 | Worker separato non admin, sandbox, repo/workspace per progetto e approvazioni | prompt injection, traversal, esfiltrazione, isolamento, allowlist, revoca, branch policy, stop; nessuna esecuzione non fidata sul server di controllo | P0 |
| F09 | F05,F08 | Controllo remoto secondo #5, pairing privato con MFA/ACL, TLS, autenticazione e vault locale | accesso/revoca, CSRF, replay, sessioni, nodo offline, heartbeat, rete cellulare iPhone→Windows, gateway 8787 sempre loopback, misure consumo | P1 |
| F10 | F06,F09 | UI mobile/web accessibile: task, nodi, consensi, evidenze, annullamento, handoff, stato vero; identità Brace | desktop/iPhone viewport e dispositivi reali, screen reader, errori e recupero, nessun successo fittizio | P1 |
| F11 | F02,F07,F08,F10 | Verticale C1 catalogo offline + generazione e revisione AI isolata | dataset preservato, ZIP compilabile, installazione e condivisione nativa, inferenza locale e cloud free reale con prova quota/consenso/latency | P1 |
| F12 | F08,F11 | Verticali C2 CRUD/auth e C3 gruppi/ruoli, scope dichiarato | auth vera, CRUD, secondo dispositivo, separazione utenti, concorrenza e revoca; non spacciare demo per prodotto | P1 |
| F13 | F09,F10,F11,F12 | CI/build firmate, test end-to-end, tre piloti assistiti, manuale e release readiness | npm suite/check/UI/export, build iOS e Android firmate e installate, regression matrix, sicurezza, zero difetti bloccanti noti, verifica costi, approvazione finale distinta | P0 |
## Review proposta (autocontrollo, non indipendente)
Rilievi corretti nel piano: PR #1–4 già implementano parte della roadmap; separare consolidamento da nuovo sviluppo. Lease necessita fencing e trattamento effetti incerti; consenso non equivale a gratuità. Separare autenticazione reale da policy; sicurezza prima di remoto e tools. Non dichiarare build firmata da bundle. #6 owner-only non è fallback automatico; upstream invoca CLI in YOLO e sovrascrive GEMINI_API_KEY dall'input; prima dell'attivazione occorrono pin CLI, policy tools, verifica account e prova. Review RV-01 ancora richiesta.


## Addendum v0.2 — consolidamento verificabile e pacchetto RV-01 (24 novembre 2026)
Baseline per review: main f8e64a98a37d4f40177ea0bbb13006db93ee874e, stack #4 fed1b4147b8d92945cc42eca85fd58e375dee014, #5 502880bc40a67a806640f5b8ce345cbb612b08c8, policy #6 36bbd023755578bf3dc99614ff45c20b4d41212e. Tutte aperte; #1 ora riportata mergeable (non prova CI). Confronto con merge-base 8d5871a3: main ha solo LICENSE.md e 3 righe aggiunte al README; stack #4 avanti 16 commit, indietro 2, 45 file. Sovrapposizione per percorso solo README; preservare avviso copyright e LICENSE, integrare README senza promuovere prove storiche a risultati correnti.

### Procedura proposta F02, dopo approvazione F00
1. Congelare SHA e inventario; creare branch di integrazione da stack #4, portare main con merge normale (nessun force push), confrontare contenuti e preservare LICENSE/avviso copyright. Non usare merge PR #2–4 su main separatamente. Alternativa: branch da main e merge stack #4. Non alterare branch storici.
2. Integrare #5 documentale e #6 quarantena/policy dopo controlli di compatibilità; confrontare albero finale con stack e main. Separare pilota LAN temporaneo da controllo remoto privato; niente esposizione del gateway di sviluppo.
3. Rieseguire npm ci, npm run check, npm test, npm run export:web, npm run test:ui sul candidato consolidato; controllare che il workflow raggiunga il nuovo branch e che i job non siano skipped. Build native solo su runner gratuito verificato. Verificare artifact e digest, niente pubblicazione. Richiedere review RV-01, merge solo con autorizzazione e CI verde sullo SHA finale.
4. Tracciare tutte le PR precedenti nel nuovo candidato senza chiuderle prima del consolidamento verificato. Non considerare mergeable o CI storica sufficiente per il merge.

### Evidenza CI storica verificata, non nuova esecuzione
- #1: https://github.com/gianpaolobol/Forgia/actions/runs/43137411915 — tre job success (web, android, ios-simulator).
- #4: https://github.com/gianpaolobol/Forgia/actions/runs/43236598763 — tre job success, log del 12 novembre: Node 51 test/51 pass/0 fail, TypeScript nel medesimo step riuscito, Playwright 3 pass. Quattro artifact elencati non scaduti al controllo: APK ARM64 debug-signed, AAB senza firma, ZIP simulatore iOS, xcarchive iPhone senza firma. Non scaricati né installati in questa iterazione. Nessuna CI di #6 riportata.

### Rilievi di lettura statica e nuovi casi obbligatori
| ID | Rilievo sullo SHA #4 | Caso di accettazione / gate |
|---|---|---|
| R01 | server/jobs.ts serializza soltanto dentro un processo; disk.ts rename non è lock tra processi | F05: due processi concorrenti, claim unico, fencing e crash recovery; transazione su quota e claim |
| R02 | tests/pilot.test.ts accetta la stessa chiave con idea, provider e consenso cambiati; jobs.ts non memorizza fingerprint terminale | F05: definire idempotenza immutabile; retry identico restituisce stesso ID; payload/consenso mutato con stessa chiave deve essere rifiutato (409) o nuova chiave; test dopo riavvio e retention |
| R03 | server/main.ts verifica credenziale alla richiesta HTTP, ma worker di jobs.ts non ricontrolla revoca/scadenza prima di run | F08/F09: revocare utente mentre job queued e dimostrare che non parte; per running definire annullamento e blocco effetti futuri, audit senza segreti |
| R04 | server/main.ts legge host HTTPS pilot da env e lo usa direttamente in listen; kit PowerShell restringe IPv4 privata ma server non impone lo stesso vincolo | F08/F09: rifiutare wildcard e interfacce pubbliche, servizio remoto separato e ACL; verificare 8787 loopback anche con configurazione errata |
| R05 | server/providers.ts e routing.ts hanno ID e profili hardcoded; local mode dedotto da ID, non prova effettiva del runtime | F03/F04: registry validato, runtime locale verificato senza cloud, autorizzazioni esplicite, aggiunta provider senza patch al router |
| R06 | storico CI non prova installazione fisica, provider free reale o merge candidate | F11/F13: build firmata e installata con evidenze, prove gratuite reali, ripetizione suite su SHA finale |

### Richiesta di review RV-01
Revisore esterno: verificare copertura requisiti F00–F13, procedura F02 (incluso copyright), casi R01–R06, sicurezza F01/F08/F09, dipendenze e criteri misurabili. Registrare identità/modello/sessione, SHA del piano e decisione APPROVED oppure CHANGES_REQUESTED con rilievi e criteri. Conservare stessa identità logica e baseline per review dei deliverable; non sostituire una review indipendente con autocontrollo. Se non disponibile, eseguire inventario e preparazione evidenze, non avviare implementazioni applicative. Stato v0.2: proposta, gate non soddisfatto.

## Addendum v0.3 — evidenze riprodotte e gate CI (24 novembre 2026)
Baseline invariata main f8e64a98, stack #4 fed1b414, PR #5 502880bc; #6 prima di questa iterazione 0a40a3cf. Tutte le PR #1–6 ancora aperte, API mergeable true (non è un'approvazione). RV-01 non assegnato, nessuna review registrata su #6. Nessun nuovo run PR sullo SHA #6 di partenza. La v0.3 è una proposta, non un piano approvato.

Evidenze e riproduzione: [audit iterazione 3](evidence/2026-11-24-iteration-03.md). Node 22.16.0, cinque blob sorgenti verificati per SHA, 5 test mirati: 3 pass, 2 fail. R01 confermato sullo storage (lost update fra istanze), test coda multiprocesso ancora necessario. R07: digest duplicato tra identità viene accettato con scelta del primo ID. R08: profilo iOS dipende dal nome esatto del branch storico e la CI non copre tutti i target stacked; test di configurazione flag 0/1 passato, rilievo workflow statico. Nessuna modifica applicativa.

| ID | Dipende | Criterio aggiuntivo | Evidenza richiesta |
|---|---|---|---|
| R07 | F08,F09 | Configurazione account fail-closed: rifiutare digest condivisi, ID duplicati o mapping ambiguo, validazione all'avvio e al reload, nessuna riattribuzione silenziosa | fixture sintetiche, scadenza/revoca, ordine invertito, reload atomico e audit redatto; nessuna credenziale reale |
| R08 | F02,F09,F13 | CI su tutti i target d'integrazione approvati; profili pilot/standard espliciti e distinti, nessuna dipendenza dal nome del branch storico; mantenere LAN disattivata nelle build standard | verificare trigger su branch consolidato, configurazione Expo, build di entrambi i profili se runner gratuito, installazione fisica separata |

R01 richiede inoltre test di storage concorrente con due istanze e processo distinto. Ripetere tutti i casi su Node 24 e candidato consolidato. Nessuna promozione della CI storica a CI corrente. Per RV-01 includere queste evidenze e i nuovi criteri; prima della review non eseguire F02 implementativo. Nessuna disponibilità effettiva di agente esterno verificata in questa sessione.

## Addendum v0.4 — coda multiprocesso e sospensione quota (24 novembre 2026)
Stato: proposta, gate RV-01 ancora aperto. Baseline main f8e64a98, stack #4 fed1b414, #5 502880bc, #6 iniziale a0669cd8. Confronto GitHub: nessuna sovrapposizione di percorsi tra delta #4/#5/#6 rispetto a main; rimane README tra main e stack storico. Non prova compatibilità funzionale. [Evidenze iterazione 4](evidence/2026-11-24-iteration-04.md).
- R01 ora riprodotto anche con due processi OS: lo stesso job viene eseguito due volte. Claim unico, lease, fencing e test di crash sono P0 prima di attivare qualsiasi worker concorrente.
- R09 (F04/F05/F07): 429 sintetico diventa failed anziché sospeso/riprendibile. Formalizzare suspended con nextEligibleAt, Retry-After validato, checkpoint, retry limitati e quota/consenso rivalutati. Ripresa senza duplicare effetti incerti; mai bypass quote. Test 429, riavvio, revoca e quota ancora esaurita.
- Controllo positivo: esito terminale preservato al riavvio senza callback. Tre casi ripetuti tre volte, 1/3 pass per esecuzione, su due blob verificati e runner sintetico; Node 22, non CI completa. Mantenere come regressioni da rieseguire su Node 24 dopo F02 e F05. Nessun cambiamento applicativo.

## Addendum v0.5 — quota atomica condivisa (24 novembre 2026)
Proposta, RV-01 non approvato. Baseline main f8e64a98, #4 fed1b414, #6 iniziale 94333dca; nessuna review o CI riportata per #6. [Evidenza iterazione 5](evidence/2026-11-24-iteration-05.md): 3 test × 3, 2/3 pass per run, callback sintetici. Gateway e disk originali verificati, altre dipendenze isolate con stub. Due gateway su stessa directory e oggetti storage distinti superano il limite 1 (2 callback, count persistito 1); consenso negato e serializzazione stesso oggetto passano. F04/F05 R10 P0: prenotazione transazionale quota condivisa prima del callback, contatore monotono, fencing, cache separata dai contatori, cooldown persistente, gestione conservativa degli effetti incerti. Criterio: N istanze/processi, limite L, massimo L callback e contatore coerente dopo restart; ripetere con dipendenze reali su Node 24. F04/F07 R11: distinguere 429 reale da indisponibilità, auth/policy o fallimento permanente; planAuto usa 429 aggregato (rilievo statico). Definire classificazione e test prima di implementare. Proposta SQLite sul coordinatore locale descritta nell'evidenza, non decisione approvata; nessun accesso DB da rete e niente transazione aperta durante inferenza. Rivalutare compatibilità Windows, migrazione e rollback con RV-01. Nessuna modifica applicativa.

## Addendum v0.6 — fattibilità transazionale e congelamento baseline (24 novembre 2026)
Proposta da sottoporre a RV-01. [Evidenza iterazione 6](evidence/2026-11-24-iteration-06.md): prototipo SQLite isolato, Node 22.16.0, SQLite 3.49.1, 5 casi ripetuti 3 volte (15/15 esiti). 8 processi contendono cap 3, 3 prenotazioni persistite; rollback dopo uscita senza commit; lease/fencing sequenziale, marker effetto incerto non reclamato e persistente. Non dimostra correzione R01/R09/R10 nel prodotto. F05: claim+quota in unica transazione, marker pre-dispatch, riconciliazione esplicita; nessun replay automatico incerto. Verificare Node 24 Windows/Linux, crash e migrazione, heartbeat, reale concorrenza claim, quota token/costo. Nessun cambiamento applicativo. Congelare questa versione per richiesta RV-01: ulteriori prove possono essere allegate senza cambiare la baseline; eventuale revisione dei requisiti genera nuova versione esplicitamente sottoposta a review. Il gate non è superato. Nessun merge.


## Addendum v0.7 — 25 novembre 2026, modalità C
Autorizzazione esplicita del titolare, AGENTS.md 30671e65418cf240993d4eadd6e45f0671553cc1. Supera i precedenti vincoli di sospensione preventiva per F00/F02/F06: RV-01 rimane pendente e obbligatorio per validazione definitiva. Nessun merge main. Inventario congelato: main f8e64a98a37d4f40177ea0bbb13006db93ee874e, stack PR #1–4 fed1b4147b8d92945cc42eca85fd58e375dee014, #5 502880bc40a67a806640f5b8ce345cbb612b08c8, #6 30671e65418cf240993d4eadd6e45f0671553cc1. F02: candidato su ai/codex/v1-consolidation con albero #4, licenza e copyright main, specifica #5, policy/evidenze #6. Verificare confronto blob inclusi asset, CI sul candidato, regressioni e review. Prossimo incremento: R04 host privato e R08 opt-in pilota, poi R05–R07 routing e F05 coda. Gemini resta in quarantena. Autocontrollo dell'autore non indipendente.


## Addendum v0.8 — R08/F09 separazione profili (25 novembre 2026)
Baseline #9 a2d329cd, #8 a747090a. Modalità C: implementazione reversibile, RV-01 non approvato. Dipende da F02/R04. Task R08a: disattivare connessione pilota standard iOS/Android anche con URL valorizzato; iOS opt-in preesistente con indirizzo privato modificabile, Android opt-in nuovo con CA e origine HTTPS privata obbligatorie in configurazione build. Web resta loopback. Test: flag mancanti/0, URL pubblico/privato, flag per altra piattaforma, URL/CA mancanti e forme ambigue, iOS senza URL, web con flag. R08b: CI per ramo integrato e verifica bundle/config reali, build e test su dispositivi, ancora aperto. Non cambiare workflow o attivare provider in R08a. Autocontrollo: due validatori (config JS, runtime TS) da confrontare con test, non equivalgono a review indipendente. Gate finali invariati.


## Addendum v0.9 — R07a/F08/F09 (25 novembre 2026)
Base PR #10 382f81ac. Modalità C, RV-01 pendente. Validare l'intero snapshot account prima di associare un token; rifiutare qualsiasi ID o digest duplicato anche se scaduto, campi invalidi e timestamp UTC non canonici; lista vuota valida (revoca totale). Validazione all'avvio e ad ogni richiesta autenticata, senza cache permissiva. Errori di configurazione generici senza dati sensibili. Matrice: identità distinte, scadenza esatta, revoca, digest condiviso in entrambi gli ordini, ID duplicato con digest differente, voce malformata, snapshot corretto dopo errore, data impossibile. Dipende da R04/R08a. Non risolve R03 (revoca dopo accodamento), né prova TLS o file replacement concorrente; test integrati e RV-01 restano necessari. Autocontrollo non indipendente.

## Addendum v0.10 — R11a/F04/F07 (25 novembre 2026)
Base #11 5c4686f, modalità C; RV-01 pendente. Distinguere esclusione per quota/riserva da nessun candidato compatibile, 401/403 upstream, 502 risposta non valida, 503 rete/servizio, 504 timeout. Solo quota effettiva/riserva o tutti i tentativi in quota producono 429; errori misti mantengono una causa non quota con priorità deterministica. Nessun retry dello stesso provider; fallback gratuito consentito invariato; errori storage/policy non tipizzati interrompono. Messaggi aggregati fissi, nessun contenuto upstream sensibile. Conservare status noti nella coda/API (non confondere 401 del pilota con l'esito asincrono del job); R09 sospensione durevole e R10 quota atomica restano aperti. Test: nessun provider, consenso negato, contesto troppo grande, quota/riserva, auth, rete, risposta invalida, timeout, errori misti, fallback riuscito e storage. Test classificatore isolato e integrazione gateway; CI completa e revisione RV-01 necessarie. Autocontrollo non indipendente.


## Addendum v0.11 — F05a, 25 novembre 2026
Base PR #12 b651b8f2, modalità C, RV-01 pendente. Primo incremento applicativo isolato del registro job SQLite (Node 24 previsto, Node 22 disponibile per test): enqueue atomico con limiti globali/sessione e dedup immutabile del payload; claim e fencing monotono per job; lease con scadenza; marker persistito prima del dispatch; recupero di claim non inviato, terminale incerto per dispatch scaduto, nessun replay automatico; heartbeat e completamento solo del lease attivo. Test DB temporaneo, due connessioni, riapertura, chiave conflittuale, scadenza, stale worker e limiti. Non collegare ancora al gateway live: F05b migrazione JSON, integrazione coda e quote atomiche, revoca e test multiprocesso/Windows restano obbligatori. Nessun nuovo servizio o costo. Revisione indipendente e CI finale non sostituite da autocontrollo.


## Addendum v0.12 — F05b.1, 25 novembre 2026
Baseline PR #13 e86ee2ad; modalità C, RV-01 pendente. Prima del collegamento al gateway, rendere verificabile il recupero senza claim, validare timestamp e token lease in tutte le transizioni e liberare metadata lease terminali. Matrice: clock NaN/negativo/frazionario/overflow rifiutato senza mutazione; claim simultaneo di processi distinti => un solo vincitore; kill del processo dopo dispatch => uncertain e nessun replay; kill prima dispatch => claim con fence superiore; duplicati simultanei => ID unico e payload mutato 409; regressione F05a. Test su SQLite reale, nessun provider. Dipendenze F05a; F05b.2 (migrazione JSON, directory privata, worker/API, revoca e quote atomiche) resta aperto, nessun cambio live. Autocontrollo non indipendente; CI e Node24/Windows da verificare.


## Addendum v0.13 — F05b.2a migrazione offline (25 novembre 2026)
Baseline #14 9a143b229; RV-01 pendente, modalità C. Dipende da F05a/b.1. Inventario: jobs.v1 JSON conserva input solo queued/running; terminali non hanno fingerprint. IDs e sessioni devono restare invariati. Task: importatore transazionale one-shot su ledger vuoto, marker SHA256 snapshot; nessuna riscrittura del JSON, nessuna attivazione automatica. Running legacy => uncertain (mai replay automatico), terminali preservati con payload ignoto non riutilizzabile, queued validati e normalizzati senza elevare consenso. Duplicati/ambiguità/corruzione/limiti => rollback totale. Ripetizione dello stesso snapshot no-op; snapshot diverso o destinazione occupata => rifiuto. Arrestare ogni writer legacy prima del cutover; backup e directory privata, rollback operativo, integrazione worker/HTTP, retention e quote restano separati.

| Test | Accettazione |
|---|---|
| M1 | queued/terminal/running, ID e sessioni preservati; running mai acquisito |
| M2 | stesso digest dopo riapertura idempotente; snapshot diverso rifiutato |
| M3 | collisione o input invalido => nessuna riga/marker, sorgente invariata |
| M4 | terminali senza fingerprint non riutilizzabili, scope e consenso preservati |
| M5 | destinazione non vuota e caps rifiutati; regressioni lease |

Autocontrollo tecnico separato dalla revisione RV-01, ancora non disponibile. Nessun merge o rilascio.

## Addendum v0.14 — F05b.2b, worker durevole (25 novembre 2026)
Base #15 08fddf963ddcec36e6956a3ef527ebb4b81129f1. Modalità C, RV-01 pendente. Dipende da F05a/b.1/b.2a. Worker esplicito a un job per invocazione, separato da HTTP: claim, decodifica validata del payload, autorizzazione fail-closed immediatamente prima del marker dispatch, heartbeat periodico, completamento fenced; errore di esecuzione dopo marker => lascia esito incerto senza replay; diniego prima del dispatch => cancellazione terminale senza invio (nuova transizione ledger). Nessun dato sensibile nei messaggi di stato. Test W1 successo e mapping, W2 revoca e configurazione indisponibile, W3 payload invalido, W4 errore dopo dispatch e recupero uncertain, W5 lease perso durante attesa autorizzazione, W6 heartbeat durante lavoro. Nessun collegamento gateway live: quote atomiche, retention, lifecycle, ACL directory, integrazione HTTP/UI e revoca in-flight restano aperti. Autocontrollo non indipendente. Nessun merge o attivazione provider.


## Addendum v0.15 — F05b.2c-Q / R10 (25 novembre 2026)
Modalità C, base PR #16 976ea5d1, RV-01 pendente. Anticipare quota atomica prima dell'adapter gateway. Registro SQLite unico per pilot e locale, solo provider cloud noti, tetto 20/giorno UTC non elevabile, riserva 4/8 applicabile in transazione, contatore addebito prima di ogni tentativo (nessun rimborso automatico), cooldown remoto persistente oltre mezzanotte, clock retrogrado fail-closed. Bootstrap esplicito una volta da snapshot quota storico o attestazione archivio nuovo; mai azzerare quota durante migrazione. Nessun collegamento live prima di cutover offline, protezione DB, compatibilità API e prove revoca. Matrice Q1 bootstrap e riapertura, Q2 limite e riserva, Q3 rollover UTC/clock retrogrado, Q4 cooldown persistente e monotono, Q5 validazione provider/limiti/snapshot, Q6 concorrenza multiprocesso, Q7 rollback bootstrap. Test Node SQLite reale, autocontrollo distinto da RV-01; nessuna inferenza, nessun nuovo costo. Dipendenze successive: adapter di quota e cache separata, consenso e gratuità verificati prima della prenotazione, abort e mapping 429, test HTTP e cutover; registry dinamico estenderà allowlist solo dopo verifica. Non promuovere il modulo isolato a correzione del gateway live.


## Addendum v0.16 — F05b.2c-G / R10, 25 novembre 2026
Base #17 5115a024, modalità C, RV-01 pendente. Collegare il registro quote al gateway tramite opzione esplicita `quotaLedger`, non attivata in main.ts. Quota cloud autorevole in SQLite, tetto massimo 20, riserva 4/8 verificata nuovamente in transazione dopo eligibility; nessuna chiamata senza consenso/gratuità o grant, nessun rimborso dopo abort. 429 durante inferenza imposta cooldown persistente minimo 60s (Retry-After da integrare separatamente). In modalità SQLite bypass della cache cloud JSON (no lettura/scrittura), per evitare affidamento su cache e contatori legacy concorrenti; cache locale legacy invariata. Test G1 due gateway/storage distinti stesso DB e cap 1, G2 diniego consenso/eligibility senza consumo, G3 cooldown dopo riapertura, G4 riserva atomica dopo ranking con concorrente, G5 nessun uso cache legacy cloud; regressioni legacy. Non attivare prima di cutover esclusivo, cache cloud separata, revoca e API/worker, integrazione 429 e CI. Autocontrollo non RV-01.

## Addendum v0.17 — macroblocco F05, cutover loopback (25 novembre 2026)
Baseline #18 3550c197, backup iteration-30 identico, main f8e64a98. RV-01 pendente; modalità C accelerata. F05-L: collegare API esistenti, ledger, import e worker dopo bind; segnale di cancellazione fino al gateway; avvio opt-in solo locale. D1: inizializzazione esplicita, idempotenza e isolamento, risultato persistente; D2: migrazione running incerta senza replay e cloud rifiutato. D3 (pendente): HTTP reale e regressione UI; D4: Node24/Windows ACL e build. F05-C: cutover quota/cache cloud condiviso e revoca/sospensione 429 restano gate separati; non attivare cloud/HTTPS pilota in SQLite prima delle prove. Non è approvazione RV-01.

### Evidenze F05-L (v0.17, autocontrollo)
D1, D2 e D4 PASS in Node 22.16.0 con SQLite reale; D3 PASS con HTTP loopback, processo gateway reale, adapter Ollama reale e risposta fixture (nessuna inferenza). D4 = rifiuto normale avvio con DB vuoto/marker assente; ACL Windows resta prova separata D5. Coda locale candidata operativa via API, non certificata V1.0. Restano cache/quote cloud con migrazione atomica, revoca/sospensione, retention/fairness, ripresa UI dopo reload e CI/build, RV-01. Il loopback è confine fidato: readLocal non autentica utenti; non usare su LAN o Internet.


## Addendum v0.18 — F05-C1, cache cloud durevole (25 novembre 2026)
Base #19 fc48a25e; RV-01 pendente, autocontrollo distinto. Cache SQLite separata dal JSON, chiave SHA-256 con namespace versione, provider, modello, scope e prompt; nessun prompt in chiaro nella chiave. Risultato validato a lettura/scrittura, TTL 24 ore, cap globale 100, transazione per inserimento/eviction. Consenso, quota valida e eligibility rimangono gate anche su cache hit; nessun contatore consumato per hit, nessuna promessa di deduplicazione di richieste contemporanee. Cache non attiva nel server main: cutover cloud esclusivo, revoca, cooldown/migrazione e ACL restano gate. C1 persistenza e isolamento fra scope/modello/provider; C2 TTL e limite; C3 input/cache corrotti fail-closed; C4 gateway con due connessioni, consenso/eligibility e contatori; C5 regressioni G1–G7 e F05-L. Nessun provider reale o costo. Non modificare main né abilitare cloud.


## Addendum v0.19 — F05-C2, bootstrap cloud protetto (25 novembre 2026)
Base #20 05ddb6bc, RV-01 pendente. Preparare quota/cache SQLite nel gateway loopback già migrato, senza consentire inferenza cloud. Opt-in esplicito `FORGIA_SQLITE_CLOUD_STATE=1`; bootstrap offline una sola volta con `FORGIA_SQLITE_CLOUD_INITIALIZE=1` e snapshot gateway.v1 presente; non dedurre archivio nuovo da file assente. Creazione esclusiva, directory e sidecar privati (ACL Windows da provare), nessuna ricreazione o reset al riavvio, verifica dei tre provider prima del bind. Conservare JSON e backup; mai avviare writer legacy in parallelo, procedura offline resta precondizione operatore. Quota e cache condividono un DB dedicato; cloud e LAN restano disabilitati, nessuna chiamata reale. Test B1 import conteggi e persistenza, B2 snapshot assente/corrotto e bootstrap duplicato, B3 DB assente/marker assente, B4 privacy file e symlink, B5 integrazione gateway e regressioni C4/C5. Non promuovere a cutover cloud completo: revoca, sospensione durevole, Retry-After, migrazione job cloud, CI, Windows, RV-01 rimangono aperti. 

## Addendum v0.20 — F05/R09, ripresa quota durevole (25 novembre 2026)
Base #23 1c8b7820685eac3f5c38aea6e26faea22410ed77; mantiene portfolio e catalogo OpenRouter del candidato. Issue #24, esecutore Codex, RV-01 pendente. Non abilitare provider cloud né LAN nel gateway SQLite. Sospensione atomica e fenced solo per diniego quota esplicito tipizzato (pre-inferenza o HTTP 429 esplicito), non per errori di trasporto o esiti incerti. Deadline Retry-After conservativa, minimo 60s; limite giornaliero fino al successivo giorno UTC. Se il routing ha altri errori, non promuovere a retry sicuro. Persistenza deadline e numero di sospensioni (massimo due riprese), nuovo controllo autorizzazione/consenso e quota a ogni claim, nessun rimborso dei tentativi. API job mantiene stato queued con nextEligibleAt; /plan restituisce 429 con ID se sospeso. Tabella aggiuntiva, nessun downgrade del writer dopo cutover: backup coerente offline prima di prova.

| Test | Criterio |
|---|---|
| S1 | Retry-After delta/data, valori invalidi e limiti; mai anticipare il valore valido |
| S2 | sospensione fenced; due connessioni, reopen, nessun claim prima della deadline, nuovo controllo auth |
| S3 | limite due riprese, esito incerto non ripetuto, lease perso non riscrive |
| S4 | HTTP reale con adapter locale e risposta 429 fixture, stato queued/deadline persistente dopo restart e zero invocazioni anticipate |
| S5 | regressioni gateway/ledger/worker, routing mixed failure non sospeso, CI e typecheck su Node 24 |

Nessuna equivalenza fra fixture e inferenza reale, né tra autocontrollo e revisione indipendente. Restano revoca cloud/in-flight, cutover, UI ripresa e build/installazione.

S4 esteso: persistere anche cooldown dei due runtime locali nel ledger condiviso, senza riduzione; un altro job dopo riavvio non deve aggirare Retry-After. Il cloud usa il registro quote dedicato. Il writer JSON legacy resta fuori dal cutover SQLite.


## Addendum v0.21 — F08/R03, grant pilota e revoca (25 novembre 2026)
Base #25 2d061cbb, issue #26, esecutore Codex; RV-01 non disponibile, autocontrollo distinto. Per il pilota HTTPS legacy: fingerprint derivata da ID, digest del token e scadenza; nessun bearer persistito; grant fissato alla richiesta, isolato per lettura, idempotenza e cache. Job precedenti senza grant non eseguibili/leggibili nel pilota: backup offline prima del cambio. Verifica snapshot corrente al dispatch, polling seriale 250ms con timeout 1s e abort, controllo finale; la revoca non può annullare invii già effettuati né garantire rilevamento di cambiamenti transitori fra due letture. Nessuna nuova esposizione o attivazione cloud, SQLite resta loopback-only. A1 diniego prima del dispatch, A2 abort in-flight, A3 controllo finale, A4 snapshot non verificabile, A5 grant valido e cleanup; A6 rotazione/scadenza e isolamento lettura, A7 coda legacy e compatibilità locale, A8 HTTP HTTPS e gateway integrato, CI/build. Non chiudere R03 o F08 senza integrazione e review. 

## Addendum v0.22 — F05/F08, ripresa UI (25 novembre 2026)
Base #27 9cba4c86; issue #28; RV-01 pendente. Marker persistito prima del POST, ricevuta UUID con origine e sessione dopo accettazione; retry di ricevuta è esclusivamente GET. Idempotency-Key anche web (deduplica server solo dove supportata), nessun replay se POST o salvataggio ambiguo, nessun bearer persistito. Abbandono esplicito non cancella il job; nessun invio successivo mentre il recupero è aperto. Dopo recupero backup, un turno senza ricevuta non è ripetuto dalla funzione retry. Matrice U1 marker/chiusura, U2 persistenza/isolamento origine, U3 validazione e privacy, U4 browser reload con un solo POST, U5 rete/backup e regressioni UI, U6 nativo. Storage client non è lock multi-tab; non dichiarare exactly-once o cancellazione remota. Cloud resta disabilitato nel candidato SQLite. Gate CI e RV-01 invariati.


## Addendum v0.23 — F04/F05 R11 preflight quota (25 novembre 2026)
Base #29 d51a06b4, issue #30, RV-01 non disponibile. Piano prima delle modifiche: P1 catalogo OpenRouter HTTP 429 conserva Retry-After, P2 preflight tipizzato conserva cooldown SQLite e non prenota inferenza, P3 generico 429 persiste cooldown ma non promuove replay, P4 seconda connessione e riavvio non interrogano il catalogo prima della scadenza, P5 test adapter/caching/regressioni. Cloud resta disabilitato nel gateway SQLite operativo; nessun cambio provider/permessi. Criteri: fixture senza rete, assert contatori, deadline e chiamate; CI Node24 e RV-01 pendenti.

Esiti v0.23: P1–P6 PASS, G1–G7 PASS, C4 PASS in harness Node22 con SQLite reale, adapter e routing effettivi, trasporto sintetico; P6 verifica insieme adapter, routing e riapertura SQLite. Evidenza hash e comando in DEVELOPMENT_PROGRESS. R11 corretto sul candidato, non chiuso definitivamente. B5/S4/A8/U4, CI Node24, build, provider reale e RV-01 pendenti. Nessun merge.


## Addendum v0.24 — F03/F04, registro profili operativo (25 novembre 2026)
Base #31 e8495b75, issue #32, RV-01 pendente. Registro a startup per adapter già approvati, più profili dichiarativi e un solo attivo per dominio quota. M1 compatibilità legacy e identità, M2 selezione e fit, M3 configurazione malformata e duplicati fail-closed, M4 policy modello anche inattivo e divieto di endpoint/credenziali/quota in profili, M5 cambio modello conserva dominio e credenziali, M6 integrazione adapter/gateway e quota effettiva al cambio modello, M7 HTTP main e UI. Nessun nuovo runtime/endpoint, nessuna attivazione cloud SQLite o pubblicazione. Non dichiarare registro universale completo: adapter nuovi richiedono contratto, storage, autorizzazione e test; nodi remoti e handoff restano separati.

Esiti v0.24: M1–M5 e M5b PASS (6/6, Node22, SQLite reale per cambio profilo e riapertura). M6 adapter/gateway e M7 HTTP/UI non eseguiti. Controlli startup/fit e collegamento a main implementati ma non collaudati integralmente. RV-01 e CI pendenti.


## Addendum v0.25 — F06/F07, coordinatore durevole Superhandy (25 novembre 2026)
Base #33 f587fe09, issue #34, piano registrato prima delle modifiche, RV-01 pendente. Verticale CLI locale: baseline immutabile e SHA-256, DAG di task e criteri, ruoli dichiarati, gate review piano, claim transazionale, fencing, heartbeat, marker dispatch, checkpoint/handoff massimo due prima di dispatch, quarantena degli esiti incerti, revisore del piano unico per gli esiti, dipendenze sbloccate soltanto da accettazione. Il prodotto richiede review della baseline prima del dispatch; la modalità C consente lo sviluppo reversibile del candidato, non la falsificazione delle approvazioni del prodotto. Non collegare HTTP, provider o shell. Il CLI è un coordinatore locale per operatore fidato, non autentica gli attori, non prova le loro competenze/indipendenza né esegue i task.

| Test | Accettazione | Esito autocontrollo |
|---|---|---|
| H1 | DAG aciclico e baseline non sovrascrivibile | PASS |
| H2 | gate e digest esatto, separazione ID reviewer | PASS |
| H3 | claim unico tra connessioni, fencing, checkpoint | PASS |
| H4 | massimo due handoff pre-dispatch | PASS |
| H5 | scadenza dopo dispatch => uncertain, nessun replay | PASS |
| H6 | stesso revisore, esito legato a hash, rifiuto riapre, dipendenza aspetta | PASS |
| H7 | CLI e persistenza tra processi, init esclusivo | PASS |
| H8 | heartbeat estende lease ma non riattiva lease scaduto | PASS |
| H9 | due processi OS contendono un task, un solo claim | PASS |
| H10 | identità e autorizzazioni vere, revoca, disponibilità, adapter e quote | PENDENTE |
| H11 | sostituzione revisore con nuova baseline, evidenze verificate, collaudo/validatore finale | PENDENTE |
| H12 | integrazione portfolio/gateway/UI, ACL Windows, Node24 e CI | PENDENTE |

Stato: 9/9 in harness Node22 SQLite reale, typecheck isolato; non F06/F07 completati. Registro eventi non è una prova crittografica antimanomissione, gli hash degli artefatti sono dichiarati dall'operatore e non verificati dal ledger. Nessuna approvazione RV-01, nessun provider reale. 


## Addendum v0.26 — F06/F07 bridge locale (25 novembre 2026)
Base #35 a3142a34, issue #36, RV-01 pendente. Sottoinsieme operativo H10–H12: BSH1 preflight SQLite loopback e provider locale configurato; BSH2 claim approvato, dispatch fenced prima di un solo POST /jobs, sessione isolata e consenso false; BSH3 polling, risultato validato dal gateway e artefatto privato hashato, review umana separata; BSH4 timeout, errore, perdita risposta o storage non ripetono POST; BSH5 dipendenze e review invariati. Nessun nuovo endpoint, nessuna shell, credenziale o cloud. Identità CLI dichiarate da operatore fidato: autenticazione/remoto e revoca reale ancora pendenti. Test con trasporto sintetico distinti da gateway HTTP e modello reale.

Estensione BSH7–BSH9 prima del codice: ripresa esplicita solo GET da ricevuta privata, verifica baseline/fence/attore/provider e hash artefatto, riconciliazione dopo scadenza nel solo stato submitted; nessun POST o autoaccettazione. Rifiutare ricevute mancanti, alterate, attore diverso e risultato non corrispondente. Restano identità locali dichiarate e assenza di riconciliazione se la ricevuta non è stata salvata.

Esiti v0.26: BSH1–BSH9 PASS (10 test, SQLite reale, trasporto sintetico; inclusi scadenza, manomissione ricevuta, crash tra artefatto e submit); H1–H9 PASS regressione. BSH10 PASS CLI/processi e HTTP loopback reali, gateway sintetico. BSH11 integrazione main/worker/adapter locale con risposta Ollama sintetica aggiunta a scripts/test-durable-loopback.mjs, NON eseguita. Typecheck isolato sui sei file PASS, Node22. Nessuna CI completa, provider reale o RV-01. Restano H10–H12 parziali: adapter universali, grant/revoca autenticati, routing/handoff tra agenti reali e quote cloud, sostituzione reviewer, validatore, portfolio/UI, prove native e installazioni. Non dichiarare V1.0.


## Addendum v0.27 — intake portafoglio in Superhandy (25 novembre 2026)

Issue #38, base PR #37 4b13cba3, main f8e64a98, backup iteration-30 3550c197.
F06/F07: integrazione in sola lettura del piano portafoglio con il ledger
persistente. I1 baseline deterministica con SHA-256, ID e repository esatto;
I2 fail-closed su progetti non schedulabili, riferimenti ambigui e ruoli non
validi; I3 dipendenze, gate di approvazione, riapertura SQLite e revisore
coerente; I4 esclusione dei task portfolio dal bridge AppSpec prima di
accesso al gateway; I5 CLI produce JSON installabile nel ledger.
Non è assegnazione automatica a sviluppatori, autenticazione o verifica
indipendente. Inventario effettivo di ogni repo, adapter e grant reali,
UI e validazione finale restano pendenti. RV-01 non assegnato, nessun merge.


## Addendum v0.28 — F07/F08 policy di dispatch locale
Base #39 2676fdbe2; issue #40, perimetro locale senza endpoint aggiuntivi. RV-01 ancora pendente. Criteri G1 scope esatto e scadenza; G2 privacy file POSIX/symlink; G3 verifica fresca a ogni controllo e digest immutabile per processo; G4 digest legato al dispatch e ripresa originale GET-only; G5 revoca prima del POST o prima della consegna; G6 compatibilità CLI manuale; G7 processi CLI, SQLite su disco e HTTP loopback sintetico. Autocontrollo G1–G6 10/10 + H1–H9 9/9, G7 PASS, typecheck isolato PASS. Non promuovere a F08 completo: auth vera, policy gateway/worker e nodi remoti, revoca attiva durante inferenza, ACL Windows, validazione indipendente e provider reali ancora richiesti. Continuare con BSH11/B5/S4/A8/U4/M6/M7 e consolidamento UI/CI; evitare nuove microfeature se è possibile collaudare i flussi cumulativi.


## Addendum v0.29 — F05/F07 pin del modello nella coda durevole (25 novembre 2026)
Issue #42, base #41 ee28abb8; RV-01 pendente. MP1 compatibilità snapshot legacy e schema durevole con pin opzionale; MP2 confronto esatto con modello locale attivo prima del dispatch, mancata configurazione rifiutata; MP3 pin persistito, idempotenza e ripresa 429 dopo riapertura SQLite senza chiamare un modello diverso; MP4 bridge richiede capability durableModelPin per nuovo dispatch e invia expectedModel; GET su vecchie ricevute resta compatibile; MP5 HTTP main con Ollama fixture, pin errato e bridge grant-bound. MP1–MP3 PASS in harness isolato Node22 e SQLite su disco, W1–W9 PASS regressione, typecheck isolato PASS. MP4–MP5 fixture aggiornate, NON eseguite; non attestare collaudo HTTP/main. Pin del nome configurato, non attestazione dei pesi, grant revocabile nel worker o auth remota. Cloud, UI, CI completa, installazioni e RV-01 ancora pendenti. Nessun merge.


## Addendum v0.30 — F05/F07/F09 recupero ricevuta web (26 novembre 2026)
Issue #45, base #43 cb2ff9a9, RV-01 pendente. RR1 lookup SQLite sessione+chiave in sola lettura, RR2 GET esclusivo gateway SQLite loopback (mai pilota TLS o legacy), RR3 marker submitting web e chiave originale, persistenza ricevuta prima del polling, nessun POST su errore; RR4 regressioni e prova HTTP/UI cumulativa. RR1/RR3 helper PASS in harness isolato su SQLite reale con schema fixture; regressione jobRecovery 3/3 PASS. RR2/RR4 HTTP/main e UI browser NON eseguiti, smoke aggiornato. Non è auth multiutente, recupero nativo o prova di provider reale. #44 documentazione indipendente, non sovrascritta. Nessun merge, nessuna spesa.

## Addendum v0.31 — F14 Notification Hub (26 novembre 2026)
Mandato del titolare: issue #46, lotto isolato da #47 88762f57, senza sostituire F00–F13. F09 controllo remoto sicuro e F13 collaudo cumulativo rimangono P0. F14 dipende da F08/F09 per ingress remoti autenticati e F10 per UI; sviluppare core reversibile in parallelo, integrare solo dopo RV-01 e CI sul candidato consolidato.
| ID | Deliverable e criterio | Stato |
|---|---|---|
| N1 | Schema v1, riepilogo a vocabolario chiuso, URL evidenza ristretto, SQLite inbox, lettura, isolamento logico, conflitto dedup persistente | 2 test PASS |
| N2 | Preferenze progetto/canale default off, outbox atomica, revoca e no replay duplicati; poi lease/fencing, retry solo esito certamente non inviato, dead-letter, audit, quiet hours/digest e cap | 2 test PASS per enqueue/revoca/rollback; worker e scheduling mancanti |
| N3 | Ingress Forgia e GitHub autenticati, firma e anti-replay, source mapping, limiti, identity binding; handoff AI esplicito | aperto |
| N4 | Email autorizzata, Telegram opt-in e push supportate, free-first verificato, credenziali server, destinatari verificati, revoca e test consegna | aperto |
| N5 | UI inbox responsive, stato canali, filtri, digest/quiet hours, test iPhone/Android e desktop | aperto |
| N6 | Evento sintetico e reale autorizzato end-to-end fino a canale gratuito, CI, documentazione configurazione/costi e rollback, review RV-01 | aperto |
N1/N2 sono libreria non collegata al gateway, nessuna API remota, nessun invio. Owner è un argomento fidato, non autenticazione. Non trattare gli identificatori come dati anonimi; adapter dovrà derivarli da fonti autorizzate e non inviarli senza consenso. Vietati WhatsApp Web e scraping; valutare ntfy e WhatsApp ufficiale solo separatamente, senza nuove spese. Non riattivare record revocati. Rollback del lotto: non integrare il branch; nessuna migrazione sul DB operativo o configurazione esterna eseguita. Node22 test isolati 4/4 PASS e typecheck isolato PASS; Node24/CI e tutti i gate di prodotto ancora aperti.

## Addendum v0.32 — F14 N2 delivery worker (26 novembre 2026)
Base #48 93ef3886; issue #46, RV-01 pendente. F09/F13 restano P0. Coda aggiuntiva SQLite collegata all'outbox N1/N2, senza riscrittura distruttiva.
| ID | Criterio | Autocontrollo |
|---|---|---|
| N2a | claim esclusivo tra due connessioni, fence e lease, stato sent senza replay | PASS |
| N2b | intent persistito prima di chiamata, riapertura DB e scadenza => uncertain, nessun replay | PASS |
| N2c | revoca tra claim e intent, anche dopo ri-opt-in | PASS |
| N2d | retry soltanto con prova di mancata consegna, 3 tentativi totali, backoff 30/60 s, dead-letter | PASS |
| N2e | eccezione trasporto => uncertain, isolamento owner | PASS |
N1/N2 regressione 4/4 PASS; totale 9/9, Node22 Linux, SQLite reale, adapter sintetico. Typecheck isolato PASS. Il worker non è un servizio schedulato, non autentica l'owner, non conferma la gratuità del canale né l'identità del destinatario. Non può fermare una consegna già avviata; l'esito incerto non va reinviato automaticamente. Status di consegna distinto da outbox di consenso: usare NotificationDelivery.status, non interpretare pending nell'outbox come mancata consegna. runOnce indica transizione registrata, non successo della consegna. La scadenza di sending è riconciliata alla prossima claim o finish. Quiet hours, digest, cap/rate limit globale, audit append-only, riconciliazione manuale, concorrenza multiprocesso, adapter autorizzati, UI, Node24/CI e prove live restano aperti. Non eliminare la tabella delivery su DB utilizzato: perderebbe gli stati terminali e consentirebbe replay; rollback solo mantenendo dati e disattivando il worker. Nessuna modifica al DB operativo o gateway; non integrare prima di CI e review.


## Addendum isolato F14 N2 — policy di consegna (26 novembre 2026)
Issue #46, base #49 fa407976. Quiet hours UTC, criticità, pacing persistente e recheck atomico; Autocontrollo 26 novembre 2026 su 74a557c0baa28e3d036b07c8252f376b9040a1b9: 12/12 PASS (3 nuovi, 9 regressioni), 0 fail/skip, Node 22.16.0 Linux, SQLite reale (memoria e disco, due connessioni e riapertura). File ricostruiti localmente con hash identici ai blob GitHub: notificationDelivery.ts 311c86690119c1ef74bf279df1d2d295f6449869, notificationHub.ts 9055fd496be0c1d8fa3f090533798727496f4c2c, notification-delivery.test.ts 62b7b9cba22f9f6d7349e5d4b85f41bc81a8b847, notification-hub.test.ts 99a5e55679f9de0bc3ef7f3090887cf41f444040. TypeScript 5.8.3 strict noEmit isolato PASS con tipi Node locali; non è npm ci/check o CI cumulativa Node24. Nessuna review indipendente o consegna esterna.
Documento docs/NOTIFICATION_DELIVERY_POLICY.md. Digest, rate cap globale provider, UI, ingress autenticato e canali reali restano aperti. Questa appendice va riportata nel piano cumulativo al momento dell'integrazione dopo CI e RV-01; non sostituisce i progressi F09/F13.

## Addendum F14 N3 — ingress GitHub firmato (26 novembre 2026)
Base #53 2503dcbe; #52 separata. N3a–d: HMAC SHA-256, scope repository/workflow/owner, dedup persistente run/attempt, timestamp bounded, redazione e pipeline inbox/outbox/worker sintetico. Nuovi test predisposti, non ancora eseguiti. Nessun listener, webhook reale, costo, segreto reale o invio. CI e RV-01 pendenti. Riconciliare appendici con F09 al futuro consolidamento, senza sovrascrivere. Vedere docs/NOTIFICATION_GITHUB_INGRESS.md.

Autocontrollo 26 novembre 2026 su checkpoint 30afe736b4630c450813e3e1f3da317f063fda36: 16/16 PASS (4 nuovi N3, 12 regressioni N1/N2), zero fail/skip, Node 22.16.0 Linux, SQLite reale in memoria e su disco, adapter esterno sintetico. Sei blob ricostruiti e hash Git identici: notificationGithubIngress.ts 87ea20b2c66bc37947b621e195000519d6491944, notification-github-ingress.test.ts 82083d92218ed54a8b5aa5f674c4e48b3c49d902, notificationHub.ts 9055fd496be0c1d8fa3f090533798727496f4c2c, notificationDelivery.ts 311c86690119c1ef74bf279df1d2d295f6449869, notification-hub.test.ts 99a5e55679f9de0bc3ef7f3090887cf41f444040, notification-delivery.test.ts 62b7b9cba22f9f6d7349e5d4b85f41bc81a8b847. Comando `node --experimental-strip-types --test tests/notification*.test.ts`; TypeScript 5.8.3 strict noEmit isolato PASS con tipi Node locali. Clone DNS non disponibile; non è npm ci/check completo o CI cumulativa Node24. Nessun webhook o consegna reale, credenziale reale, agente indipendente o esposizione; RV-01 pendente.


## Addendum F14 N4 — digest inbox programmabile (26 novembre 2026)
Base #54 c06ac8c0, checkpoint codice 699db2d1. Opt-in per owner/progetto, aggregazione giornaliera UTC, dedup atomico con membership, recupero dopo riavvio, revoca anche con rollback orologio, batch max 500, nessun invio o modifica inbox/outbox ordinaria. 9/9 test isolati (5 N4, 4 N1/N2 hub), SQLite reale Node22, quattro blob hash-identici, tsc strict isolato PASS. Vedere docs/NOTIFICATION_DIGEST.md. Non è scheduler in esecuzione o canale esterno; UI, binding destinatario, adapter free-first, CI cumulativa e RV-01 restano aperti. Riconciliare appendice senza sovrascrivere F09. Separatamente #52 e4af5712, run [45824683058](https://github.com/gianpaolobol/Forgia/actions/runs/45824683058): tre job success, 288/288 unit, RC16–21 PASS, 3 smoke HTTP sintetici e 4 Playwright PASS. Nessuna prova installazione fisica/provider reale attribuita alla CI.


## Addendum F14 N5 — adapter Telegram (26 novembre 2026)
Base #55 a93d44f1, #52 e4af5712 con CI run 45824683058 success verificato, main f8e64a98, backup iteration-30 presente. N5 implementazione isolata: pin locale owner/chat/token, opt-in esplicito e revoca backlog, HTTPS fisso gratuito senza paid broadcast, sospensione persistente con Retry-After, quattro regressioni predisposte. Nessuna consegna reale o pairing/vault, nessuna review RV-01. Matrice e rollback: docs/NOTIFICATION_TELEGRAM.md. CI coordinata obbligatoria; email/push/UI e F09 restano aperti.


## 26 novembre 2026 — correzione CI e intento Telegram persistente
Run [45843594342](https://github.com/gianpaolobol/Forgia/actions/runs/45843594342): web e iOS success; Android TS2345 nel double Ledger del test portfolio-superhandy, prima dei test. Ripreso il fix identico a #52 (inspect:fail), senza modificare il bridge. N5 riserva lo stato paused con sentinel SQLite prima del trasporto; crash senza esito o Retry-After invalido bloccano la ripresa fino a revoca. Un esito valido riapre il canale solo se non revocato; esito ambiguo resta sospeso per ripresa locale esplicita. Aggiunte regressioni su interruzione simulata/riapertura e revoca in-flight. Nessuna migrazione distruttiva, consegna reale, costo, review o nuovo workflow. Test nuovi e CI da verificare; non dichiarare PASS anticipato. Main e #52 invariati.


## 26 novembre 2026 — F14 N6 email (candidato isolato)
#56 fd2f79c7, run [45854003824](https://github.com/gianpaolobol/Forgia/actions/runs/45854003824): 285/285 unit, 6 N5 PASS, web/iOS success, Android fallito dopo i test (risoluzione Gradle Foojay 1.0.0); richiesto rerun solo job fallito. #52 e4af5712 CI verde invariata; main f8e64a98, backup iteration-30 letto. N6: binding email dedicato, opt-in fresco, cap 1–20/giorno UTC persistente e anti-rollback, payload redatto, blocco fail-closed su crash/esito ambiguo, adapter HTTPS Brevo ufficiale iniettato. Quattro test predisposti, nessun risultato ancora. Nessun account o consegna reale; gate piano Free, mittente/consenso/vault, CI, RV-01 e prova recapito. Vedere docs/NOTIFICATION_EMAIL.md. Nessun merge, costo o modifica workflow.


## 26 novembre 2026 — F14 N7 runtime locale integrato
#57 2688bac0 CI [45863475464](https://github.com/gianpaolobol/Forgia/actions/runs/45863475464) success: 289/289 unit, 4 N6 PASS, Android/web/iOS success; retry #56 anche success. Main f8e64a98; #52 e4af5712 resta separata, 139 commit avanti rispetto al backup iteration-30 3550c197. Review #52/#57 vuote. N7 su ramo isolato: SQLite privato POSIX, inizializzazione esclusiva, snapshot scoped, ingresso nativo, letto/non letto, revoca e digest tick/watch; CLI senza trasporti reali o rete. Quattro test predisposti; esiti nuovi pendenti. Windows ACL, UI, push, pairing/vault, consegna reale, installazioni, RV-01 ancora aperti. Nessun costo, agente esterno, merge o modifica workflow. Runbook docs/NOTIFICATION_LOCAL_RUNTIME.md.


## 26 novembre 2026 — F14 N8 pannello locale
#58 af57e00b: run 45871682353, 293/293 unit, quattro N7 PASS, TypeScript/web/iOS success, Android errore Gradle Foojay dopo test; rerun del job fallito richiesto. #52 e4af5712 CI verde separata. N8: pannello HTML locale autenticato, scope fisso, filtro inbox, evidenze, letto/revoca/digest via POST con Origin e CSRF, password effimera, solo loopback, nessun trasporto/attivazione. Tre test HTTP predisposti, esiti nuovi pendenti. Runbook docs/NOTIFICATION_LOCAL_DASHBOARD.md; nessuna apertura LAN, modifica workflow, costo o merge. RV-01 e verifiche fisiche/live pendenti.
