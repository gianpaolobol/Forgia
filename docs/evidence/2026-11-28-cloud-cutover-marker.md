# [Codex] F05/R01/R10 — evidenza B5–B9, 28 novembre 2026

Base: 7331255ddeb2f85b46fe7033e2b3fed733700730. Ambiente Linux x86_64 Node 22.16.0, node:sqlite. Copia locale manuale di tre sorgenti e un test, verificati tramite `git hash-object`:

| Percorso | Blob originale |
|---|---|
| server/cloudState.ts | 4f88602b4b5b39466ae9afebf55c8b31959ac9bd |
| server/quotaLedger.ts | 0d908a4df4c69d52280d964ae31ba66cbd0bc3c4 |
| server/cloudCache.ts | 3583145501c83ee2f09ca7170b25ecabed630331 |
| tests/cloud-state.test.ts | aff2037b292163ce01f6259643aed1ca1f17c924 |

Riproduzione baseline reale: creare stato con snapshot sintetico OpenRouter used=2, prenotare (used=3), chiudere, spostare cloud.sqlite nella directory temporanea, reinizializzare con lo stesso snapshot. Output: `before loss, used: 3`; `after stale reinitialization, used: 2`. Nessuna chiamata provider. La nuova suite B5–B8, con shim di caratterizzazione del vecchio controllo main basato su existsSync quando assertCloudStateMode non esiste, ha dato 0/4; B1–B4 4/4. In B5/B7/B8 la prima asserzione del caso baseline fallisce sul downgrade; la riproduzione separata sopra verifica direttamente la perdita quota.

Delta testato: cloudState.ts blob 64d7ec9b8a54da207b03c3f7dfb0dac5473717f0; tests/cloud-cutover.test.ts blob f9b000b92bcdd6b63ec673a49be3a1493ecfa9d9 (import diretto del nuovo guard, senza shim). Eseguire `node --experimental-strip-types --test tests/cloud-state.test.ts tests/cloud-cutover.test.ts` dal checkout. Risultato effettivo: 8 test, 8 pass, 0 fail, 0 skip. B5 perdita/restore quota e cache; B6 adozione legacy; B7 WAL orfano; B8 marker symlink/permessi; B1–B4 regressioni originali. Job file fixture, non job ledger operativo. B8 skip Windows per permessi POSIX.

Il guard è collegato a main.ts prima di preparare la coda; aggiunto B9 a scripts/test-durable-loopback.mjs (riavvii HTTP dopo spostamento DB e ripristino). B9, MP3–MP5, suite npm completa, Node24 e Windows NON eseguiti in questa sessione. DNS GitHub non disponibile nel container, nessun checkout completo o CI nuova (storage non osservabile). Non prova transazione atomica tra più DB o persistenza su perdita dell'intera directory/backup obsoleto. Marker privato da conservare con l'intera directory; nessun recupero automatico in caso di perdita. Revisione RV-01 pendente. #52/#61 congelate; zero chiamate AI reali, nuovi costi o rilascio.
