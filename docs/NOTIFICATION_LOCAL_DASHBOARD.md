# F14 N8 — pannello notifiche locale
26 novembre 2026. Base #58 af57e00b; run 45871682353: 293/293 test, quattro N7 PASS, TypeScript e web/iOS success, Android errore risoluzione Gradle Foojay dopo i test; rerun del solo job fallito richiesto.
## Uso di prova (POSIX)
Inizializzare l'archivio N7 come da NOTIFICATION_LOCAL_RUNTIME.md; da un terminale interattivo privato:
```sh
node --experimental-strip-types scripts/notification-dashboard.ts "$HOME/forgia-notifications" operator demo/project
```
Aprire http://127.0.0.1:8790 sullo stesso computer e inserire utente operator e password casuale mostrata solo nel terminale. Non condividere il terminale, non redirigere l'output, non inoltrare la porta, non usare proxy o tunnel. Arrestare con Ctrl-C: la password cambia a ogni avvio. Il pannello non è accessibile da iPhone via rete, non è TLS o pairing remoto e non è un backend multiutente. Scope owner/progetto fissato all'avvio; scegliere un altro progetto riavviando. L'autenticazione Basic su HTTP è limitata al loopback fidato; non riusarla fuori da tale confine.
- Inbox responsiva, filtro non lette, evidenze GitHub validate, stato dei canali, revoca, orario digest UTC e tick manuale.
- POST protetti da Origin esatta e token CSRF, Host esatto, password effimera 256 bit, nessun CORS, no-store, frame e script vietati. Nessun input per destinazione o attivazione, nessun invio, nessuna credenziale provider.
- Scheduler automatico: comando watch N7 separato, sullo stesso archivio; il pannello non lo avvia. Sent = accettazione, non recapito. Rollback: arrestare pannello e conservare SQLite; nessuna migrazione.
## Matrice
N8a HTTP autentico loopback, auth, host, cross-site, cache/CSP; N8b filtro e scope, link, CSRF e marcatura; N8c revoca, schedule, tick e impossibilità attivazione. Test predisposti, CI da verificare. Resta da provare la resa browser e su dispositivo fisico, il collegamento privato con TLS/MFA, ACL Windows, vault, push, canali reali e RV-01. Nessuna apertura LAN o Internet.
