# F05/R01/R10 — verifica guard per-dispatch, 28 novembre 2026
Autocontrollo Codex, non revisione indipendente RV-01. Base f998b03647bbc5f8f9fa7b6959612e333f0efcfc; correzione applicativa b4a199ea3a605075e249da7c917b8ab8bdf7e3b2, ramo ai/codex/v1-dispatch-authorization-fence.
## Difetto e correzione
Il controllo periodico e quello finale non impediscono da soli un secondo effetto fra poll, né un primo effetto dopo scadenza del lease. Il guard fresco è propagato worker → coda → main → gateway; verifica il grant/modello tramite la stessa autorizzazione del worker e rinnova il lease con fencing SQLite appena prima di ciascun invio, anche dopo HTTP 429 esplicito. Un errore del guard è generico, non QuotaDeferral, quindi non abilita fallback o replay. Nessun rimborso di una quota già impegnata. Non è atomicità fra file grant, due DB e rete: rimane una finestra non transazionale, da considerare nel threat model.
## Esecuzione locale effettiva
Linux Node v22.16.0, node:sqlite, database temporanei reali, effetti sintetici in memoria, nessuna rete provider. I sorgenti sono stati ricostruiti da blob GitHub e verificati byte per byte tramite git hash-object; clone DNS indisponibile. Test nuovo tests/worker-dispatch-fence.test.ts blob de4bec1258f2d1cd77dd5253ee157ffc74af877c.
| File | Git blob |
|---|---|
| server/durableWorker.ts prima | 1730849a479b425a77be8096353b413c24624127 |
| server/durableWorker.ts dopo | 077e45006ebb018ecc1cb4167006be5cd8f81bc0 |
| server/durableInput.ts | 509e2bf34c52a8744c6ff7b66038b5c2899dd7bf |
| server/legacyJobMigration.ts | 05ba56a532c7f3c32e720a4c98b273cb6fd68d87 |
| server/modelRegistry.ts | 7b20c771494c37ddd30fc05046f086d140275d49 |
| server/quotaDeferral.ts | 6d3ebb5bce31b321ca51dc4367b70d9c85243edf |
| server/receiptLookup.ts | 2cc40871f59f713b68c578cb7700c9d661d655ff |
| src/core/receiptLookup.ts | a512b9d911768ca2db1ec42e8f26fccc19d6f234 |
| server/jobLedger.ts | 4b0ca24deed6922ebf8c3417583c0d97515ca248 |
| tests/durable-worker.test.ts | bfce6442bb42d0ca9f984ea0f92b34bf9199975d |
Comando prima/dopo: node --experimental-strip-types --test tests/worker-dispatch-fence.test.ts
- Baseline: 0 pass, 4 fail, exit 1. WF1, WF2 e WF4 osservano un effetto sintetico non impedito; WF3 manca i due controlli freschi (non è un errore funzionale di pubblicazione).
- Correzione: 4 pass, 0 fail, exit 0.
- Regressione con W1–W16 originali: node --experimental-strip-types --test tests/*.test.ts nel sottoinsieme locale di due file test: 20 pass, 0 fail, 0 skip, exit 0.
| Caso | Esito dopo patch |
|---|---|
| WF1 revoca fra due effetti, riapertura e idempotenza | PASS |
| WF2 scadenza lease prima del timer heartbeat e recupero | PASS |
| WF3 grant valido, due controlli freschi, risultato | PASS |
| WF4 verifica indisponibile, nessun effetto/risultato | PASS |
| W1–W16 regressione worker/ledger | 16/16 PASS |
## Gate residui
DF1–DF4 (gateway/adapter, quota/cache e worker) implementati ma NON eseguiti. MP3–MP5 HTTP non eseguiti. Non attestati Node24, npm ci/check/test completo, Windows, provider live, installazioni o review. CI storica #52 run 46090576320 e #61 run 45901387059: 3/3 job success ciascuna; non è CI del delta. Nessuna nuova CI avviata perché l'esistente produce quattro artefatti e lo spazio/budget storage non è osservabile; runner standard pubblici sono gratuiti, non presumere quota storage. Nessuna modifica workflow, main, #52/#61, credenziale, rete o nuovo costo.
