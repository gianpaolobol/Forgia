# Forgia V1.0 — piano maestro v0.2
Data: 2026-11-24. Stato: proposta, NON approvata da revisore indipendente. Revisore logico previsto: RV-01; identità/modello/sessione da registrare all'assegnazione. Non equiparare questo autore a un secondo agente. La presente baseline deve essere revisionata prima dell'implementazione applicativa.

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
