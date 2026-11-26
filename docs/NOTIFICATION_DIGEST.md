# F14 / N4 — digest inbox locale programmabile (26 novembre 2026)

Base PR #54 c06ac8c05ddebe40cbc9c1c28ddf2e20a7200e65; lotto isolato per issue #46, nessuna modifica F09/#52. Il core NotificationHub deve inizializzare il DB privato prima di NotificationDigest. API locale fidata, nessun endpoint, autenticazione, scheduler di processo, UI o invio esterno.

- Opt-in separato per owner/progetto con minuto UTC 0–1439 (non ora civile/DST); prima attivazione e riattivazione escludono gli eventi già presenti. null sospende nuovi digest, anche con clock arretrato; lo storico resta leggibile localmente.
- Un chiamante autorizzato invoca tick al tempo corrente. Una transazione IMMEDIATE registra aggregato, membership dei singoli eventi e prossima scadenza. Ripresa dopo ritardo accorpa le scadenze perse; nessun digest vuoto, nessuna ripetizione. Due connessioni serializzate. Cambio orario non scarta gli eventi non aggregati. Il watermark evita riaperture dopo rollback.
- Massimo 500 eventi per batch, more segnala backlog eleggibile; il resto rimane al prossimo slot. Conteggi per severità, nessun contenuto libero. Inbox eventi e outbox esistenti immutate (critici non ritardati dal digest). Nessuna email/Telegram/push aggregata ancora. Le tabelle crescono con gli eventi; retention coordinata ancora da definire.
- Il caller deve ottenere owner e progetto da autorizzazioni reali, non da input non autenticato; schedule e tick non sono integrazione di rete. Non usare DB condiviso o ripristinare uno snapshot precedente come se fosse lo stato corrente.

## Matrice e prove
| Caso | Esito autocontrollo |
|---|---|
| Opt-in, storico escluso, isolamento owner/progetto, conteggi, inbox/outbox intatte | PASS |
| Due connessioni, restart, scadenze perse, clock rollback | PASS |
| Revoca con rollback, riattivazione e filtri invalidi | PASS |
| Limite 500, backlog e timestamp ricevuto futuro | PASS |
| Errore SQLite in inserimento, rollback e recupero | PASS |
| Regressioni hub N1/N2 | 4/4 PASS |

Checkpoint codice 699db2d13aa61c9e0edea7a08b8873df6d9f2bfa: Node 22.16.0 Linux, SQLite reale, 9/9 (5 N4 + 4 hub), zero fail/skip. Ricostruzione locale con hash Git verificati: notificationDigest.ts 4be1087829722e7213b300c97ab9e89daf9f3457; notification-digest.test.ts d69a2f5664a86ec0ee492e7eca523fa3ee6b0e4c; notificationHub.ts 9055fd496be0c1d8fa3f090533798727496f4c2c; notification-hub.test.ts 99a5e55679f9de0bc3ef7f3090887cf41f444040. Comando node --experimental-strip-types --test tests/*.test.ts nel sottoinsieme ricostruito; tsc 5.8.3 strict noEmit isolato PASS. Clone diretto DNS non disponibile; nessun npm ci/check/test integrale sul nuovo lotto; N2 delivery/N3 ingress non rieseguiti qui. CI Node24 cumulativa e RV-01 ancora pendenti.

Rollback: fermare il futuro scheduler, mantenere DB e sidecar privati; non eliminare membership né riabilitare invii sulla base di snapshot vecchi. Nessuna migrazione distruttiva. Restano binding destinatario, adapter, scheduler affidabile, UI, cap globale e prove reali autorizzate. Nessuna spesa, credenziale, pubblicazione o modifica workflow.
