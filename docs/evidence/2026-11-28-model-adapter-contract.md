# [Codex] F03/F04/R05 — contratto registro–adapter (MA)
28 novembre 2026. Autocontrollo, non RV-01.

Base: b83bde3b2ab935c061d7bd9b50fe3475a2df9e38. File ricostruiti in una directory temporanea con hash Git uguali alle fonti:
- server/modelRegistry.ts 7b20c771494c37ddd30fc05046f086d140275d49
- server/providers.ts 727c224bdfa52778d5e69abef9a0ac79667802a9
- server/openRouterCatalog.ts 786956a0091cfba508345d5d7151be4c8b7b429b
- server/quotaDeferral.ts 6d3ebb5bce31b321ca51dc4367b70d9c85243edf
- server/quotaLedger.ts cd748a861d2e0c6411a09f8a00315df6b422ba8a
- tests/model-registry.test.ts 1a77ef62356cb2c7b4fc44888090b8a3b1e0a1c8

Ambiente Linux, Node 22.16.0. Nessun npm install, clone DNS non disponibile. Moduli reali, import type rimosso da Node, Response sintetiche. Nessun traffico provider reale.

Comando: `node --experimental-strip-types --test tests/model-adapter-contract.test.ts tests/model-registry.test.ts`

- Caratterizzazione MA iniziale: 2 pass, 2 fail (MA1, MA2), 0 skip. MA3–MA4 già pass. La versione finale di MA2 aggiunge caso suffisso maiuscolo.
- Dopo correzione MA: 4 pass, 0 fail.
- Regressione cumulativa finale: 10 pass, 0 fail, 0 skip. Include M5b: SQLite reale, riapertura, quota 20 e cooldown preservati dopo cambio profilo.
- SHA blob locali finali verificabili: registry ce20261a77f6a4ecd812bcbe30be6687061ea3cb; adapter fe5e72556182d85cde7e59d54c62aa973d2ac700; test MA ffb82c42e392183ec67ea0ebcded7202a2beed50.
- La fixture prezzi vuoti in gateway.test.ts ora usa example/model:free per continuare a misurare i prezzi e non la sintassi. Non eseguita suite gateway.

Vincoli: nessuna modifica endpoint, quota, consenso o guard max_price. Il controllo catalogo resta necessario; la sintassi non attesta la gratuità. Mancano test HTTP MP3–MP5/B9, Node24, typecheck completo, CI finale, provider reali, review indipendente, installazioni.

## Controllo direttiva trasversale
Nove attività attive sviluppo/build/meta osservate con prefisso della regola del titolare: Builda, Catasto, AEGIS, APE, Forgia, World Explorer, Fungo Italia sviluppo, task separato build Fungo Italia, report meta. Presenza del testo non dimostra conformità esecutiva di tutti i repo. Canonico [v1.2.0 preparato](https://github.com/gianpaolobol/registro-delle-idee/tree/docs/build-finali-protocollo-20261128) a 29c00265ea11fceb103706830a0b8f0470e3e35c; copia su main del registro ancora v1.1.0. repository.txt ha 19 voci, Builda non elencata; da coordinare nel registro senza avviare workflow. Sincronizzazione su push main e workflow_dispatch; Forgia native-test su pull_request e workflow_dispatch. Nessun dispatch, PR nuova o modifica dei workflow. Prima del freeze, mantenere checkpoint isolati; non promuovere il candidato o dichiararlo validato.
