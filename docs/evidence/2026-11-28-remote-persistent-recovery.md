# [Codex] F09 — collaudo cumulativo recupero diagnostico persistente
28 novembre 2026 — autocontrollo, non review indipendente.

Base d0e34e3742931dc9efb2a0f3effd03b57267b8b3. Main 72cc042aa334c3ad0e9a9a91c251a20fab0cf06e; backup iteration-30 3550c19758e3ab886c9ce30ed8d61467e68350ca; #52 eb5f8b1f02fdbe50a9a56b11073b34b724a1b74c; #61 c1b88fc61480ded855710bb0a68ac5c2da784f39; #62 8781ae086659be885fe2dc079284553ea8ad3c5c. Lettura GitHub effettuata, nessuna integrazione dei delta concorrenti. Workflow nativo su PR/workflow_dispatch, verifica linee guida su PR o push main: nessuna PR o dispatch nuova.

Ambiente Linux Node 22.16.0, SQLite node:sqlite effettivo. Checkout completo impossibile (DNS github.com); ricostruiti solo i due sorgenti originali, verificati con git hash-object:
- server/remoteHeartbeatAgent.ts ba626d0c39566eda72486dbf736f91f82cc13c3f
- server/remoteNodeStatus.ts 277b6a1f4b2731e99a13c7c5dddd65675b2256d3
- nuovo tests/remote-persistent-recovery.test.ts 1d31821a3fb1489f5b325105de90a7f0a0c47868

Comando: `node --experimental-strip-types --test tests/remote-persistent-recovery.test.ts`.
Tre esecuzioni consecutive: 1/1 PASS ciascuna, 0 fail/skip (durate test 68.58, 58.56, 55.95 ms). Prima prova della fixture: due richieste con stesso timestamp venivano ordinate per UUID (previsto ORDER BY created,id), non per ordine d'inserimento; corretto solo il clock della fixture per distinguere i timestamp. Non è un difetto applicativo riprodotto.

Verticale: agente reale su SQLite disco, control store reale su secondo SQLite disco, ricevitore HTTP sintetico loopback; credenziali generate per test e mai stampate. Persa risposta dopo commit, prima ricevuta recuperabile, seconda ancora in coda. Chiusura e riapertura di entrambi i DB e ricostruzione di agente/store, chiave idempotente senza duplicazione, isolamento altro operatore, progressione sequenze 1/2 senza replay, rotazione cancella diagnostica pendente e azzera online, vecchia credenziale negata, nuova sequenza 1 e nuova ricevuta, revoca operatore e nodo respinte. Sequenze osservate 1,2,3,1,2 (3 e ultimo 2 negati). Nessun comando remoto eseguito.

Non attestati: server HTTP di produzione, processo OS riavviato, Windows/DPAPI, TLS/MFA/pairing, iPhone, gateway-worker MP3–MP5/B9, Node24, typecheck completo, provider AI reali (Ollama assente, account cloud free non verificabile), CI/build, RV-01. Nessuna spesa o esposizione. Il test entra nella suite unit esistente per glob; non sostituisce i gate reali. Nessun codice applicativo cambiato. Prossimo: checkout Node24 autorizzato, npm ci/check/test, prove HTTP e provider free-first, collaudo remoto privato su dispositivi autorizzati, review e congelamento prima di una sola build finale per piattaforma.
