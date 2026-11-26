# F14 N5 — Telegram Bot adapter, 26 novembre 2026

Base #55 a93d44f1b2454f630f707a1e18aed96ee12aed2d, issue #46. Lotto separato da F09 #52. Nessuna attivazione reale, nessuna credenziale configurata, RV-01 pendente.

## Contratto
- Adapter server Node HTTPS verso api.telegram.org, POST sendMessage, TLS verificato, nessun redirect/retry automatico, deadline 10 s, risposta max 64 KiB. Nessun log di URL, token, risposta o chat ID. Messaggio a template fisso, dettagli progetto/evidenze solo in inbox. allow_paid_broadcast=false e protect_content=true. Successo solo con risposta 200, ok, ID messaggio e chat privata attesa.
- Un bot dedicato, un owner e un destinatario privato per database. L'attivazione locale richiede attestazione esplicita del consenso, pin digest di owner/chat/token, azzera preferenze Telegram e revoca backlog precedente. Riabilitare singolarmente i progetti dopo attivazione. Nessun cambio destinatario/token automatico, nessun recupero di messaggi incerti; revoca terminale. Digest non è vault, consenso booleano non è pairing verificato. Nessuna API pubblica.
- Worker riutilizza claim/fence, pacing e quiet hours del modulo delivery. Rifiuta altri destinatari, non invia se un altro send è in corso. Esito ambiguo o 429 sospende in SQLite; resume solo locale esplicito, non prima del retry_after persistito; 429 senza finestra valida blocca fino a revoca. Una revoca non annulla una richiesta già in volo. Il processo deve essere dedicato, DB privato; nessun altro sender sullo stesso bot.
- Non avviare con token reali prima di pairing con chat privata iniziata dall'utente, vault, ACL, revisione indipendente, verifica account gratuito e procedura di revoca. Nessun servizio o scheduler connesso da questo lotto.

## Matrice
| Caso | Prova | Stato |
|---|---|---|
| Opt-in esplicito, backlog escluso, isolamento, redazione e no paid | N5 test 1 | predisposto |
| 429, retry-after, restart, pin e revoca | N5 test 2 | predisposto |
| Risposta errata, redirect ed eccezione | N5 test 3 | predisposto |
| Worker concorrenti | N5 test 4 | predisposto |
| TLS/timeout/body sul trasporto reale e consegna telefono | verifica dedicata | pendente |
| npm ci/check/test e CI cumulativa | candidato coordinato | pendente |

Fonti ufficiali consultate 26/11/2026: https://core.telegram.org/bots/api e https://core.telegram.org/bots/faq. Limite gratuito indicativo un messaggio/s per chat e circa 30/s per broadcast; paid broadcasts esclusi. Email, push e consegna reale restano da integrare/verificare. Nessuna garanzia futura sulle quote.

Rollback: fermare worker, revocare binding, preservare DB/sidecar privati, non riattivare righe uncertain; disabilitare il canale prima di tornare alla versione precedente. Nessuna migrazione distruttiva. Non cancellare audit per aggirare revoca. Rotazione credenziale richiede un nuovo percorso di pairing esplicitamente revisionato.

Esecuzione locale integrale non disponibile per DNS GitHub; non attribuire PASS ai test senza evidenza. Nessuna review indipendente simulata.


## 26 novembre 2026 — correzione CI e intento Telegram persistente
Run [45843594342](https://github.com/gianpaolobol/Forgia/actions/runs/45843594342): web e iOS success; Android TS2345 nel double Ledger del test portfolio-superhandy, prima dei test. Ripreso il fix identico a #52 (inspect:fail), senza modificare il bridge. N5 riserva lo stato paused con sentinel SQLite prima del trasporto; crash senza esito o Retry-After invalido bloccano la ripresa fino a revoca. Un esito valido riapre il canale solo se non revocato; esito ambiguo resta sospeso per ripresa locale esplicita. Aggiunte regressioni su interruzione simulata/riapertura e revoca in-flight. Nessuna migrazione distruttiva, consegna reale, costo, review o nuovo workflow. Test nuovi e CI da verificare; non dichiarare PASS anticipato. Main e #52 invariati.
