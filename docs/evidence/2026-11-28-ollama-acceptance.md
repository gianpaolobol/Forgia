# [Codex] 2026-11-28 — Accettazione locale Ollama, preflight e fixture

Base: 8433e7487cd98e1e6fef356be4263ce9da8f606a. Node v22.16.0, Linux; checkout integrale non disponibile, Git DNS fallisce. 
Esecuzione locale effettiva: `node --test scripts/local-runtime.test.mjs`; 6 test, 6 pass, 0 fail, 0 skipped.
LR1 conferma e alias, LR2 endpoints/payload senza chiavi, LR3 listing mancante/duplicato/remoto/corrotto, LR4 show remoto/invalido/HTTP errore, LR5 provider non ammesso e compatibilità preflight llama.cpp, LR6 HTTP su porta effimera loopback con risposte sintetiche e URL produzione verificati. Nessun POST di inferenza né download. 
Blob Git locali dei due file testati:
- scripts/local-runtime.mjs: 61dc20056db768d9adedc056abc49e4b25b60835
- scripts/local-runtime.test.mjs: 490498a870d12e2cf1feb00d60d2d85c3a9aa0df

LA6/LA7 in scripts/test-ollama-acceptance-loopback.mjs: collaudo gateway e SQLite, una inferenza sintetica e recupero/revoca, rifiuto remoto prima del dispatch. Predisposto, non eseguito. Il runner modificato e la suite completa Node24 non sono stati eseguiti. 
Operatore: disabilitare le funzioni cloud nel runtime prima della prova reale (documentazione: https://github.com/ollama/ollama/blob/main/docs/cloud.mdx); preflight non attesta da solo la località dell'inferenza. 
Nessuna modifica al gateway produttivo, API a pagamento, segreti, installazione, CI/build o review indipendente. Main 72cc042aa334c3ad0e9a9a91c251a20fab0cf06e, backup 3550c19758e3ab886c9ce30ed8d61467e68350ca, PR #52 eb5f8b1f02fdbe50a9a56b11073b34b724a1b74c, #61 c1b88fc61480ded855710bb0a68ac5c2da784f39, #62 8781ae086659be885fe2dc079284553ea8ad3c5c. Lockfile invariato 65f3103d4929160451c7bdf6a1739bd2fc963800. 
