# F14 N7 — runtime locale inbox e digest
26 novembre 2026. Base #57 2688bac0: CI 45863475464 completata success, Android/web/iOS; 289/289 unit, N6 4/4. F09 #52 separata e non modificata.
## Avvio di prova (POSIX fidato, Node 24)
Creare una directory assoluta privata 0700 fuori dal repo; usare un percorso reale (non symlink). Esempio:
```sh
mkdir -m 700 "$HOME/forgia-notifications"
node --experimental-strip-types scripts/notification-local.ts init "$HOME/forgia-notifications"
node --experimental-strip-types scripts/notification-local.ts inbox "$HOME/forgia-notifications" operator demo/project
```
Il comando init è esclusivo: non usarlo per ripristinare un DB perduto. Arrestare i processi e fare backup offline prima degli aggiornamenti. Windows è esplicitamente bloccato finché non verificata una policy ACL. Nessuna autenticazione remota: owner/progetto sono dichiarazioni di un operatore locale fidato, non credenziali.
- publish DIR OWNER PROJECT: JSON v1 da stdin (massimo 16 KiB); validazione e dedup del core, rifiuto di progetto diverso.
- inbox / unread DIR OWNER PROJECT: snapshot JSON v1 con inbox, conteggi, digest, preferenze e stati coda; nessun indirizzo o segreto. Non redirigere dati privati a log condivisi. La preferenza non prova un canale operativo; transportActive è sempre false in questo runtime.
- read DIR OWNER PROJECT SOURCE ID: marcatura idempotente per scope.
- schedule DIR OWNER PROJECT MINUTE|off: minuto UTC 0–1439, opt-in digest; tick esegue un controllo, watch lo ripete ogni 30 s fino a SIGINT/SIGTERM. Nessun servizio installato, nessun avvio automatico.
- revoke DIR OWNER PROJECT email|telegram|push: revoca preferenza e backlog. Non esiste comando per attivare trasporto esterno o inviare realmente.
Il runtime usa lo stesso SQLite per hub, digest e delivery. Nessun gateway aperto, niente HTTP, push, email/Telegram live, credenziali, scheduler esterno o UI fisica. Il test sintetico usa un adapter email iniettato e non produce recapito reale; lo stato sent significa accettazione provider, non consegna. Per rollback fermare watch e mantenere il database; non cancellare le tabelle o il ledger. Il DB N7 nuovo non migra automaticamente archivi di prova N1–N6.
## Matrice
N7a scope, dedup, letto/non letto, digest e riapertura; N7b proiezione stati, revoca, adapter email sintetico e isolamento; N7c permessi e sidecar; N7d CLI con processi reali e SQLite su disco. Test predisposti, CI e review indipendente da verificare. Gate successivi: UI autenticata, vault, pairing, push supportata, recapito reale autorizzato, installazioni e RV-01. Nessun costo.
