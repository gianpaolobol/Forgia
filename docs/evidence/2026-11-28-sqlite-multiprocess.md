# F05/R01/R10 — prova SQLite multiprocesso 28/11/2026

Autocontrollo Codex, non review RV-01. Candidato applicativo #52 `eb5f8b1f02fdbe50a9a56b11073b34b724a1b74c`, base documentale `e8dccfd2a7668dd5732c2748f96baeb42ab52186`. Nessuna modifica al codice runtime o ai workflow; test isolato in `tests/sqlite-multiprocess.test.ts` (blob `f2c4056fbd0606536bb009b0b83c85ec5894a43c`, corrispondenza esatta locale/remoto verificata).

## Esecuzione osservata
Linux, Node v22.16.0, node:sqlite sperimentale. Cinque file sorgenti copiati dal candidato e verificati con git hash-object prima di eseguire:
- server/jobLedger.ts 4b0ca24deed6922ebf8c3417583c0d97515ca248
- server/quotaLedger.ts 0d908a4df4c69d52280d964ae31ba66cbd0bc3c4
- server/legacyJobMigration.ts 05ba56a532c7f3c32e720a4c98b273cb6fd68d87
- server/receiptLookup.ts 2cc40871f59f713b68c578cb7700c9d661d655ff
- src/core/receiptLookup.ts a512b9d911768ca2db1ec42e8f26fccc19d6f234

Comando: `node --experimental-strip-types --test tests/sqlite-multiprocess.test.ts`. Exit 0, TAP 4 pass, 0 fail, 0 skip. Durata 3381 ms. Riproducibile sul checkout Node24 previsto (non ancora provato).

| Cap | Ripetizioni | Processi per ripetizione | Richieste per ripetizione | Claim validi | Concessioni | Negate |
|---|---:|---:|---:|---:|---:|---:|
| 5 | 3 | 8 | 24 | 1 | 5 | 19 |
| 20 | 3 | 8 | 24 | 1 | 20 | 4 |

48 processi di gara (144 richieste di prenotazione sintetiche, 75 concessioni e 69 negate), più 3 processi di uscita senza close. Barriera file, due database distinti WAL, clock iniettato fisso. Ogni gara verifica persistenza del contatore alla riapertura, rifiuto oltre cap, nuovo fencing token dopo scadenza, rifiuto token vecchio e completamento del nuovo. Tre uscite deliberate exit(73): prima del marker → reclamabile solo a scadenza; dopo marker e prima dell'effetto → uncertain senza replay; dopo effetto sintetico su file → uncertain senza replay, ricevuta/idempotenza preservate e finalizzazione tardiva rifiutata.

## Limiti e gate residui
Nessun HTTP, AI, adapter, chiamata di rete o quota reale: la concessione locale non equivale a effetto esterno. Processo termina senza cleanup applicativo, non è simulazione di perdita alimentazione. Clock sintetico, non prova regressione wall-clock o coordinatore monotono. Claim e quota sono in database distinti: **nessuna atomicità claim+quota+autorizzazione attestata**. R01/R10 parziali: servono Node24 Linux e Windows, test integrati gateway/worker con quota/autorizzazioni e recovery, riconciliazione/UI e revisione RV-01. npm ci/npm run check/CI non eseguiti in questo ambiente (DNS GitHub indisponibile; candidato congelato). Non è autorizzazione a riattivare provider o pubblicare build. Zero costi nuovi.
