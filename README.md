# Forgia

Creatore di app di Gian Paolo Franceschini. Client Expo/React Native per iOS, Android e web; gateway di sviluppo Node separato. Nessun servizio a pagamento configurato.

## Già operativo
- Progetti locali, specifiche, revisioni con istruzione e ripristino senza cancellare la cronologia.
- Generatore **senza AI** di sorgenti Expo per cataloghi offline: dataset personalizzato, ricerca/categorie, preferiti, quiz opzionale sui colori e ripasso degli errori.
- ZIP esportabile dal web; percorso nativo di condivisione file implementato ma non provato su telefono.
- Recupero da backup e blocco dei dati corrotti, nessun messaggio di successo per scritture fallite.
- Gateway gratuito sostituibile: Ollama locale, Groq Free e OpenRouter :free. Quote/cache persistenti, consenso cloud, controlli prezzo e timeout. Adapter provati con risposte di test; **nessuna inferenza reale ancora eseguita**.
- Proposte AI separate dai campi attuali e dai salvataggi; dataset esistente protetto per default. Nessun modello esegue comandi.
- Policy delle deleghe con permessi, scadenza, revoca, stato MFA e blocco totale dei pagamenti. OAuth, vault ed esecutore browser **non ancora integrati**.

## Avvio locale
Node 24 e npm. `npm ci`, poi `npm start` per il client oppure `npm run web`. `npm test` esegue le prove del dominio e del gateway; `npm run check` il controllo TypeScript; `npm run export:web` produce il pannello web statico.

Per il gateway locale: configurare soltanto le variabili necessarie dell'esempio in un file ignorato `.env`, poi `node --env-file=.env --experimental-strip-types server/main.ts`. Non inserire le chiavi nel client, nei prompt o nei file esportati. Nessun provider è attivo senza configurazione. Groq deve rimanere Free; la sola presenza di una chiave non permette di conoscere la fatturazione. Non collegare un piano a pagamento. Ollama deve usare un modello realmente locale e avere le funzioni cloud disabilitate nella propria installazione. Verificare modello e licenza prima di usarlo commercialmente.

Il gateway ascolta solo `127.0.0.1:8787` e accetta il client web locale sulle origini previste. **Non esporlo su Internet o tramite tunnel.** Nessuna autenticazione multiutente, vault o sandbox remota è stata consegnata. Nel pannello ospitato il gateway locale non è utilizzabile; il generatore offline resta disponibile. I progetti sono conservati nel browser/dispositivo, non sincronizzati nel cloud. Esportare per conservarne una copia; cancellare dati del browser o disinstallare elimina i dati locali.

## Stato delle verifiche
Leggere `docs/VERIFICHE_2026-11-11.md`. Bundle JS/Hermes per iOS e Android non sono IPA/AAB firmati. Non attestano installazione fisica, TestFlight, Play Store o comportamento nativo. I test browser automatici sono predisposti ma il lancio locale è bloccato dal sandbox; è stato eseguito un collaudo manuale attraverso il browser disponibile.

## Prossime consegne
Piano e roadmap: `docs/specs/2026-11-11-free-first.md`. Scelta API e architettura dell'autonomia: `docs/API_Gratuite_Autonomia_2026-11-11.md`. Il passo successivo è attivare e misurare un modello veramente gratuito, poi completare il verticale C1 con build firmate e installazioni. Nessuna promessa di generazione universale o superiorità prestazionale è ancora dimostrata.

Non sono stati copiati sorgenti NativeBot/Vibra. Le dipendenze hanno le rispettive licenze. Il repository è pubblico. La scelta di una licenza di riuso resta al titolare.

## Identità visiva

La [guida grafica](docs/design/README.md) raccoglie le tavole e la scelta **B · Brace** per pulsanti e icone.

## Selezione automatica dei motori AI

In **Motori AI**, seleziona **Scelta automatica**. Configura i tre adattatori
nel gateway tramite le variabili in `.env.example`. Per Ollama avvia il
servizio locale e installa un modello compatibile sul computer. Per Groq e
OpenRouter usa chiavi dedicate e i rispettivi piani gratuiti.

Il gateway considera famiglia dell'app, fase e quota locale residua. I profili
iniziali privilegiano Groq per la prima bozza di un catalogo e OpenRouter per
gestionali, gruppi e revisioni di cataloghi. Ollama rimane utilizzabile senza
invio al cloud. Sono preferenze iniziali, da calibrare con prove sui modelli
effettivamente collegati. I campi `OLLAMA_FIT`, `GROQ_FIT` e
`OPENROUTER_FIT` accettano un oggetto JSON con punteggi
`catalog`, `tracker`, `community`, `draft`, `revision` da 1 a 10
e un eventuale limite `maxInputBytes` da 1 a 32000.

Con consenso cloud, un errore del fornitore o una quota esaurita può far
passare al successivo candidato gratuito. La proposta mostra quale modello
ha risposto. Per gestionali e gruppi si preparano i requisiti. La generazione
di sorgenti resta disponibile per i cataloghi.
