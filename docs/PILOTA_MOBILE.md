# Pilota AI su iOS e Android

Usare un host già disponibile a costo incrementale zero, raggiungibile da entrambi i telefoni. Il servizio pilota richiede un certificato TLS valido per il nome host e considerato attendibile dai dispositivi. Il pannello web continua a usare il gateway di sviluppo su loopback.

1. Avviare llama.cpp o Ollama sull'host e configurare il modello locale secondo il README.
2. Impostare `FORGIA_PILOT_HOST` all'indirizzo su cui il servizio deve ascoltare, `FORGIA_PILOT_PORT` alla porta del servizio e `FORGIA_PILOT_TLS_CERT`, `FORGIA_PILOT_TLS_KEY` e `FORGIA_PILOT_ACCOUNTS` ai percorsi dei file protetti. Avviare il server con `node --env-file=.env --experimental-strip-types server/main.ts`.
3. Per ogni tester generare un codice casuale di 32 byte in esadecimale, un UUID distinto e una scadenza UTC. Il file dei tester contiene un array di oggetti con i campi `id`, `sha256` (hash del codice esadecimale come testo) ed `expiresAt` (timestamp ISO 8601). Consegnare il codice al tester tramite il canale concordato. Per revocarlo rimuovere la voce aggiornando il file con una sostituzione atomica. Conservare l'UUID in caso di rotazione dello stesso tester.
4. In fase di build impostare `EXPO_PUBLIC_FORGIA_PILOT_URL` all'origine HTTPS. In GitHub Actions la build legge la variabile di repository `FORGIA_PILOT_URL`. Da **Motori AI** inserire il codice, quindi scegliere **Verifica gateway pilota**. Il codice rimane in memoria per la sessione dell'app. I progetti locali appartengono al profilo del dispositivo. Usare una sola identità tester per installazione. Per il modello locale lasciare il consenso cloud disattivato.
5. Su iPhone e Android creare un catalogo con dati sintetici, chiedere due revisioni, esportare lo ZIP e installare la build del progetto generato. Annotare dispositivi, commit, versione, modello e risultato.
6. Durante una richiesta staccare la rete, riattivarla e usare **Riprova con l’AI**. Ripetere con il codice scaduto o revocato. Verificare con due codici distinti che un tester possa leggere soltanto i propri risultati.

I lavori e le risposte del modello sono conservati sul server, nelle code e nella cache con capienza limitata. Il retry riconosce i lavori ancora presenti nella coda. Quando un lavoro fallisce, il retry può avviare una nuova elaborazione. Usare dati sintetici durante il pilota e a fine collaudo e a servizio fermo rimuovere la coda `.data/pilot/` e svuotare il campo `pilotCache` di `.data/gateway.v1.json`, conservando i contatori di quota e la cache della demo web. L'accesso pilota è destinato a un gruppo ristretto di tester.

## Esito di riferimento del 12 novembre 2026

Con llama.cpp e Qwen2.5-1.5B-Instruct Q4_K_M è stato generato il catalogo
**Orto Forgia** con Lavanda. Le due revisioni hanno aggiunto Rosmarino e Salvia,
conservando le schede precedenti. Il percorso è stato provato in HTTPS in locale
e dalla chat web fino al download dello ZIP. Con Qwen2.5-0.5B-Instruct, la
prima configurazione ha restituito JSON valido ma non ha applicato la modifica
richiesta. Queste prove riguardano un solo catalogo e due revisioni.
