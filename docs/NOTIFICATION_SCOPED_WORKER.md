# F14 N9 — worker integrato per scope locale
26 novembre 2026, base #59 c4de11d4, CI 45879597929 success su tutti e tre i job.
Il runtime locale ora compone email e Telegram con la stessa connessione SQLite e vincola owner e progetto. Il filtro avviene nella transazione di claim, prima di lease e dispatch; pacing e cap restano condivisi per owner/canale, non aggirabili cambiando progetto. Le API legacy senza filtro mantengono comportamento owner-wide. Nessuna attivazione automatica, nessuna nuova preferenza, nessun trasporto di default nel runtime: solo binding e trasporto esplicitamente iniettati da un futuro chiamante locale autorizzato. Il pannello e la CLI non espongono queste API. La revoca non annulla un invio già iniziato. Il risultato booleano indica completamento della transizione del worker, non recapito.
## Matrice
- N9a email: evento precedente in altro progetto, tenant diverso, riapertura e assenza replay.
- N9b Telegram: mancata attivazione, owner errato, revoca e isolamento.
- N9c claim: progetto invalido, pacing condiviso e compatibilità con worker esistente.
Test predisposti, CI da verificare; trasporti sintetici, nessun recapito reale o attivazione account. Per uso reale restano obbligatori vault, associazione destinatario, conferma piano Free, autorizzazione e RV-01. Nessuna modifica schema; rollback arrestando tutti i processi e ripristinando il binario precedente, che non offre filtro esplicito: non usarlo per worker a scope ristretto. Non esporre gateway.
