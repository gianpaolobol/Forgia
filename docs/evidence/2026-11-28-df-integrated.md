# F05/R03 — esecuzione DF1–DF7 — 2026-11-28
Autocontrollo Codex, non revisione RV-01. SHA sorgente: `1b74dcfc614ab2889e1d788d6123651893b3039c`.
Linux x86_64, Node v22.16.0, SQLite integrato (sperimentale).
Checkout completo non disponibile (DNS); ricostruita la chiusura delle dipendenze runtime del test con 17 blob originali, verificati con git hash-object. package.json locale minimale type=module, non sostituisce npm ci.

Comando: `node --experimental-strip-types --test tests/dispatch-authorization-fence.test.ts`

| Scenario | Esito |
|---|---|
| DF1 revoca al 429 esplicito, niente seconda inferenza prima del poll | PASS |
| DF2 revoca durante eleggibilità cloud, niente inferenza/rimborso/cache/risultato | PASS |
| DF3 lease scaduto prima dell'invio, recupero incerto | PASS |
| DF4 grant/fence validi, fallback autorizzato e risultato | PASS |
| DF5 revoca dopo risposta locale, contatore conservato senza cache/pubblicazione | PASS |
| DF6 revoca dopo risposta cloud, niente persistenza/rimborso/replay | PASS |
| DF7 risposte autorizzate, cache locale e SQLite cloud e quota preservate | PASS |

Due esecuzioni: 7 test, 7 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo ciascuna. Durata 470.830266 ms e 434.477813 ms. Avvisi sperimentali Node per type stripping e SQLite.

Ledger SQLite reali, provider e callback autorizzazione sintetici, cache locale in memoria. Non dimostra invio reale, HTTP, persistenza della cache locale dopo crash, atomicità fra DB, assenza di race residua, Node24, installazioni o revisione indipendente. Nessun segreto o chiamata cloud.

## Manifest blob (Git SHA-1)
```
tests/dispatch-authorization-fence.test.ts a7482effdf7fd17a6d55f4a2f4566387a0877c5a
server/cloudCache.ts 3583145501c83ee2f09ca7170b25ecabed630331
server/durableInput.ts 509e2bf34c52a8744c6ff7b66038b5c2899dd7bf
server/durableWorker.ts 077e45006ebb018ecc1cb4167006be5cd8f81bc0
server/gateway.ts 79e31bea2a7ff04cf031d6ef7f5d8f8cb809a713
server/jobLedger.ts 4b0ca24deed6922ebf8c3417583c0d97515ca248
server/legacyJobMigration.ts 05ba56a532c7f3c32e720a4c98b273cb6fd68d87
server/modelRegistry.ts 7b20c771494c37ddd30fc05046f086d140275d49
server/openRouterCatalog.ts 786956a0091cfba508345d5d7151be4c8b7b429b
server/providers.ts 727c224bdfa52778d5e69abef9a0ac79667802a9
server/quotaDeferral.ts 6d3ebb5bce31b321ca51dc4367b70d9c85243edf
server/quotaLedger.ts 0d908a4df4c69d52280d964ae31ba66cbd0bc3c4
server/receiptLookup.ts 2cc40871f59f713b68c578cb7700c9d661d655ff
server/routing.ts c063ada7b6f03ca0bdcc514001de27bb253917fd
server/routingFailure.ts 7455c5481b496d67d22b2ecb098d15960e337ce2
src/core/receiptLookup.ts a512b9d911768ca2db1ec42e8f26fccc19d6f234
src/core/spec.ts 2e206f2c59ce6e5a21c788e389c7baea35b94a13
```
