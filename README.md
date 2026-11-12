# Forgia

Creatore di app di Gian Paolo Franceschini. Client Expo/React Native per iOS, Android e web; gateway di sviluppo Node separato. Nessun servizio a pagamento configurato.

## Già operativo
- Progetti locali, specifiche, revisioni con istruzione e ripristino senza cancellare la cronologia.
- Generatore **senza AI** di sorgenti Expo per cataloghi offline: dataset personalizzato, ricerca/categorie, preferiti, quiz opzionale sui colori e ripasso degli errori.
- ZIP esportabile dal web; percorso nativo di condivisione file implementato ma non provato su telefono.
- Recupero da backup e blocco dei dati corrotti, nessun messaggio di successo per scritture fallite.
- Gateway gratuito sostituibile: Ollama e llama.cpp in locale, Groq Free, OpenRouter :free e Cloudflare Workers AI Free. Quote/cache persistenti, consenso cloud, controlli prezzo e timeout. Inferenza reale verificata con llama.cpp e Qwen2.5-0.5B-Instruct.
- Proposte AI separate dai campi attuali e dai salvataggi; dataset esistente protetto per default. Nessun modello esegue comandi.
- Policy delle deleghe con permessi, scadenza, revoca, stato MFA e blocco totale dei pagamenti. OAuth, vault ed esecutore browser **non ancora integrati**.

## Demo con AI locale

Su Linux x86-64, con Node 24, npm, Python 3, curl e shasum disponibili, esegui
`bash scripts/demo-locale.sh`. Il primo avvio scarica llama.cpp e il modello Qwen
(469 MiB), verifica i checksum e avvia pannello, gateway e runtime su loopback.
Su macOS o altre architetture usa un `llama-server` già installato nel PATH
oppure indica il binario con `FORGIA_LLAMA_SERVER`.

Apri `http://127.0.0.1:8081` sullo stesso computer. Crea un progetto con nome e
idea, poi scegli **Avvia la chat**. La chat usa il motore configurato per
preparare la specifica. Le richieste per servizi riconosciuti compaiono in
**Accessi**. I cataloghi supportati si possono esportare dalla chat. Questa
demo usa solo il modello locale.

Su iOS e Android il microfono richiede le autorizzazioni del sistema e usa
il riconoscimento vocale sul dispositivo quando disponibile. La chat salva i
messaggi sul dispositivo. Per le risposte AI il client nativo richiede ancora
un gateway HTTPS autenticato.

## Avvio locale
Node 24 e npm. `npm ci`, poi `npm start` per il client oppure `npm run web`. `npm test` esegue le prove del dominio e del gateway; `npm run check` il controllo TypeScript; `npm run export:web` produce il pannello web statico.

Per il gateway locale: configurare soltanto le variabili necessarie dell'esempio in un file ignorato `.env`, poi `node --env-file=.env --experimental-strip-types server/main.ts`. Non inserire le chiavi nel client, nei prompt o nei file esportati. Nessun provider è attivo senza configurazione. Groq deve rimanere Free; la sola presenza di una chiave non permette di conoscere la fatturazione. Non collegare un piano a pagamento. Ollama deve usare un modello realmente locale e avere le funzioni cloud disabilitate nella propria installazione. Verificare modello e licenza prima di usarlo commercialmente.

Il gateway ascolta solo `127.0.0.1:8787` e accetta il client web locale sulle origini previste. **Non esporlo su Internet o tramite tunnel.** Nessuna autenticazione multiutente, vault o sandbox remota è stata consegnata. Nel pannello ospitato il gateway locale non è utilizzabile; il generatore offline resta disponibile. I progetti sono conservati nel browser/dispositivo, non sincronizzati nel cloud. Esportare per conservarne una copia; cancellare dati del browser o disinstallare elimina i dati locali.

## Collaudo su dispositivi

La [guida di collaudo](docs/COLLAUDO_NATIVO.md) descrive le build di prova e i passaggi da verificare. Gli identificativi iOS e Android usano `it.gianpaolofranceschini.forgia`.

## Stato delle verifiche
Leggere `docs/VERIFICHE_2026-11-11.md`. Bundle JS/Hermes per iOS e Android non sono IPA/AAB firmati. Non attestano installazione fisica, TestFlight, Play Store o comportamento nativo. I test browser automatici sono predisposti ma il lancio locale è bloccato dal sandbox; è stato eseguito un collaudo manuale attraverso il browser disponibile.

## Prossime consegne
Piano e roadmap: `docs/specs/2026-11-11-free-first.md`. Scelta API e architettura dell'autonomia: `docs/API_Gratuite_Autonomia_2026-11-11.md`. Il passo successivo è ampliare le prove sui modelli, attivare gli account cloud Free e completare il verticale C1 con build firmate e installazioni. Nessuna promessa di generazione universale o superiorità prestazionale è ancora dimostrata.

Non sono stati copiati sorgenti NativeBot/Vibra. Le dipendenze hanno le rispettive licenze. Il repository è pubblico. La scelta di una licenza di riuso resta al titolare.

## Identità visiva

La [guida grafica](docs/design/README.md) raccoglie le tavole e la scelta **B · Brace** per pulsanti e icone.

## Selezione automatica dei motori AI

Copia `.env.example` in `.env`, compila soltanto i motori che vuoi usare e
avvia il gateway con `node --env-file=.env --experimental-strip-types server/main.ts`.
Avvia poi `npm run web` e in **Motori AI** aggiorna i collegamenti.

| Motore | Configurazione |
| --- | --- |
| Ollama | Avvia Ollama su `127.0.0.1:11434`, scarica un modello locale e imposta `OLLAMA_MODEL`. |
| llama.cpp | Avvia `llama-server -m /percorso/modello.gguf --alias forgia-local --host 127.0.0.1 --port 8080` e imposta `LLAMACPP_MODEL=forgia-local`. |
| Groq | Imposta modello e chiave di un account Free. Abilita `GROQ_FREE_PLAN_CONFIRMED=true` solo dopo aver verificato il piano senza fatturazione. |
| OpenRouter | Imposta chiave e ID di un modello con suffisso `:free`. Il gateway controlla i prezzi dichiarati prima dell'inferenza. |
| Cloudflare | Imposta ID account, token Workers AI e `CLOUDFLARE_MODEL=@cf/meta/llama-3.1-8b-instruct`. Abilita `CLOUDFLARE_FREE_PLAN_CONFIRMED=true` solo su Workers Free. Mantieni l'account sul piano Free. |

I piani dei provider sono verificati dall'operatore per Groq e Cloudflare.
Le chiavi restano nel gateway e `.env` è escluso da Git.

In **Scelta automatica**, le prime bozze semplici privilegiano i modelli
locali. Famiglia, fase, dimensione, quota residua e lavori in attesa
determinano i candidati. Forgia permette 20 richieste al giorno per ciascun
motore cloud. Protegge le ultime 4 richieste per le operazioni più
complesse, oppure le ultime 8 quando ci sono almeno due lavori in attesa.
I motori locali dipendono da memoria, velocità e modello installato.
I profili iniziali si possono calibrare via `*_FIT` con punteggi da 1 a 10
per `catalog`, `tracker`, `community`, `draft`, `revision` e un
eventuale `maxInputBytes` da 1 a 32000.

La coda locale usa un solo worker e alterna le sessioni del pannello quando
possibile. Accetta fino a 16 lavori attivi, fino a 3 per sessione. Al
riavvio riprende i lavori in attesa e segnala quello interrotto. Conserva
fino a 32 esiti locali. Il pannello mostra lo stato durante la sessione
corrente. L'eventuale passaggio al cloud richiede il consenso. Se nessun
motore compatibile risponde, il lavoro restituisce un errore e può essere
riprovato. I modelli propongono specifiche da approvare. L'export di
sorgenti Expo è disponibile per i cataloghi.
