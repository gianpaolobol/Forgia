# [Codex] F05/R01 — integrità quota SQLite persistita (28 novembre 2026)

Base: 72e0c81b7178fb3b8cce9dea2005f3ed6ba3cd3f. Sorgente originale server/quotaLedger.ts blob 0d908a4df4c69d52280d964ae31ba66cbd0bc3c4, suite Q1–Q7 blob 6ac005c0a8fc408bc4103eecfe4ee6dcce4cc2f9: entrambe verificate con git hash-object nel runtime Linux Node 22.16.0.

## Difetto e correzione
Il confronto lessicografico del giorno persistito con il giorno corrente interpretava una stringa non valida come giorno passato, trasformando used=20 in 0. Anche last_ms negativo passava il controllo precedente. Un'unica validazione canonica YYYY-MM-DD (intervallo supportato da dayOf e roundtrip UTC) ora copre snapshot e righe persistite; il clock negativo è respinto prima di aggiornare il meta. La transazione annulla la modifica in caso di errore; non ripara o reinizializza il DB. Nessuna nuova dipendenza.

## Prove eseguite
- Baseline esatta: node --experimental-strip-types --test tests/quota-integrity.test.ts -> 1 PASS, 4 FAIL, 0 skip.
- Delta: stesso comando -> 5 PASS, 0 FAIL, 0 skip.
- Regressione cumulativa mirata: node --experimental-strip-types --test tests/*.test.ts (checkout parziale con sole due suite Q1–Q7/QI1–QI3) -> 12 PASS, 0 FAIL, 0 skip, inclusi quattro processi OS in concorrenza per gli ultimi cinque grant.
- Tre fixture con date vuota, inesistente, pre-epoch: rifiuto di read/reserve/cooldown e verifica SQL read-only che used=20 e data danneggiata restino invariati. Clock negativo: rifiuto e conservazione del meta. Giorno UTC successivo valido: nuovo grant regolare.
- Blob del delta collaudato: cd748a861d2e0c6411a09f8a00315df6b422ba8a (sorgente) e b03b7a7878856ad0089e7c45bba3aa70c80050f6 (nuovi test), verificati anche dalla risposta GitHub create_blob.

## Limiti
SQLite reale ma corruzione logica iniettata solo in DB temporanei, clock sintetico. Non rileva ogni alterazione coerente (es. data valida modificata offline) né verifica autenticità/backup, non è il collaudo HTTP B9/MP3–MP5, Node24, Windows o suite npm completa. Nessuna credenziale o provider reale. CI storiche #52 e #61 non certificano questo delta. Il runtime non risolve DNS GitHub, Node24 e checkout completo indisponibili. Runner standard del repo pubblico gratuiti ma storage artefatti non verificabile; nessuna nuova CI/build avviata. #62 Builda è una linea concorrente separata, non toccata. RV-01 e V1 aperti.
