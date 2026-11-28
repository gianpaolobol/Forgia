# F05 — fencing fallback automatico durevole, DA1–DA3 / MP5
Data: 28 novembre 2026. Autocontrollo, non revisione RV-01.
Base congelata PR #52 eb5f8b1f02fdbe50a9a56b11073b34b724a1b74c; ramo di collaudo ed782ddfebc4c55e78ca16d920d61142519f657d; correzione 26fd4ea2bafc5b6a0b989a4076c96feafc02af82.

## Difetto e correzione
Il percorso auto legacy intercetta ProviderError/timeout e prosegue con il prossimo provider anche se complete è già stato invocato. In modalità SQLite un esito ignoto deve invece arrivare al worker per classificazione conservativa, senza seconda inferenza. Il delta introduce una marcatura per singolo tentativo immediatamente prima di complete (sia adapter normale sia SQLite cloud), e attiva conservativeAuto da main soltanto in modalità SQLite. Dopo dispatch soltanto QuotaDeferral tipizzata può proseguire: il rifiuto esplicito non rappresenta un esito ignoto. Preflight e comportamento legacy invariati. Nessun rimborso delle quote o modifica del modello, policy di consenso, credenziali, rete o autorizzazioni.

## Esecuzione locale realmente effettuata
Linux, Node v22.16.0, modulo node:sqlite sperimentale. Checkout completo non disponibile (DNS GitHub non risolto); estratti dal connettore e ricostruiti i soli file runtime pertinenti, verificati tramite git hash-object. Nessuno stub dei moduli produttivi: i test utilizzano trasporti provider sintetici e storage in memoria. Nessuna rete provider.
| File | Git blob SHA verificato |
|---|---|
| server/gateway.ts (prima) | f10392aa4b07b7ab458ff46f4dbeb83786b0f199 |
| server/gateway.ts (dopo) | 40ef83d60af3756f942ee41f064b62d1da86f0a0 |
| server/providers.ts | 727c224bdfa52778d5e69abef9a0ac79667802a9 |
| server/quotaDeferral.ts | 6d3ebb5bce31b321ca51dc4367b70d9c85243edf |
| server/routing.ts | c063ada7b6f03ca0bdcc514001de27bb253917fd |
| server/routingFailure.ts | 7455c5481b496d67d22b2ecb098d15960e337ce2 |
| server/modelRegistry.ts | 7b20c771494c37ddd30fc05046f086d140275d49 |
| server/openRouterCatalog.ts | 786956a0091cfba508345d5d7151be4c8b7b429b |
| server/cloudCache.ts | 3583145501c83ee2f09ca7170b25ecabed630331 |
| src/core/spec.ts | 2e206f2c59ce6e5a21c788e389c7baea35b94a13 |
| tests/durable-auto-dispatch.test.ts | c864a6ba87682c2722de4e3f7cce95d5ca70af84 |
| tests/routing.test.ts | 7b683fa038fd6c313a73bf8708a32b2ae1c860c1 |
| tests/preflight-cooldown.test.ts | b66541f59514a3d3a8ba0ae722207bc081ddd0f6 |

Comando mirato: node --experimental-strip-types --test tests/durable-auto-dispatch.test.ts.
Baseline (stesso test nuovo, gateway precedente verificato): 1 pass, 2 fail, exit 1; DA1 fallisce al primo HTTP 503 con Missing expected rejection; DA2 fallisce al 429 non tipizzato con Missing expected rejection. DA3 pass. Dopo correzione: 3 pass, 0 fail, exit 0; DA1 copre 503, risposta non JSON, errore trasporto; DA2 distingue HTTP 429 esplicito e ProviderError 429; DA3 conferma preflight e fallback legacy. 
Comando regressione nel sottoinsieme estratto: node --experimental-strip-types --test tests/*.test.ts. 15 pass, 0 fail, 0 skip, exit 0 (3 DA + 8 routing + 4 preflight). 
I test non eseguono main, worker, DB delle quote o coda HTTP reale; non attestano la suite completa, npm ci, tsc, Windows, provider live o installazioni. MP3–MP5 sono predisposti ma non eseguiti: MP5 richiede porte loopback 8787, 11434, 8080 e verifica HTTP protetto, stato uncertain, riavvio/ricevuta e alternativa solo su 429. Non dichiarare risolti tutti R01/R10 né atomicità fra ledger distinti.

## Gate
CI storica riconfermata: #52 run 46090576320 e #61 run 45901387059, ciascuno 3 job success (web/Android/iOS simulator); non CI del delta. Nessun nuovo run: repo pubblico e standard runner gratuiti, ma il workflow carica quattro artefatti, quota storage non osservabile. Main e PR congelate immutate; Notification Hub delta separato. Nessuna spesa o modifica workflow, nessun agente esterno invocato. Necessari npm ci, npm run check, npm test su Node24 autorizzato, review RV-01 e nuovo candidato con CI verificata prima di qualsiasi integrazione.
