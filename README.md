# Forgia

<!-- inizio-riquadro-linee-guida -->
> **Linee guida v1.1.0** — Questo progetto segue le linee guida comuni dei progetti di Gian Paolo Franceschini: leggi prima [`LINEE_GUIDA.md`](LINEE_GUIDA.md), poi [`AGENTS.md`](AGENTS.md) e [`STATO.md`](STATO.md).
<!-- fine-riquadro-linee-guida -->


> **Copyright © 2026 Gian Paolo Franceschini — All rights reserved for original proprietary contributions.** See [LICENSE.md](LICENSE.md). Third-party licenses and GitHub's permitted platform uses remain applicable.


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

## [Codex] Worker locale Builda

Avvia [Builda](https://github.com/gianpaolobol/Builda) sullo stesso computer con `python -m builda serve --port 8766`. Avvia il gateway Forgia con `BUILDA_LOOPBACK_PORT=8766` nel file `.env` lato server. La route si attiva solo se la porta è configurata.

```sh
curl --fail http://127.0.0.1:8787/builda/v1/experiments \
  -H 'Content-Type: application/json' \
  -d '{"problem":"calibration","engineVersion":"0.1.0","datasetVersion":"synthetic-v1","seed":42,"budget":64}'
```

Il worker verifica problema, seed, budget, strategia e versioni. Per `terrain` con Builda 0.1.0 il dataset è `synthetic-building-tiles-v1`. La risposta contiene identificativi, hash, metriche e decisione dell'esperimento. Il medesimo job restituisce una ricevuta persistente anche dopo un riavvio di Forgia. Per un esito incerto, consultare il registro SQLite di Builda prima di ritentare. Il worker usa un solo slot di esecuzione, un timeout di 30 secondi e serve client locali senza `Origin`. Il percorso è collaudato senza provider AI su un host di sviluppo.

## Stato delle verifiche
Leggere `docs/VERIFICHE_2026-11-11.md`. Bundle JS/Hermes per iOS e Android non sono IPA/AAB firmati. Non attestano installazione fisica, TestFlight, Play Store o comportamento nativo. I test browser automatici sono predisposti ma il lancio locale è bloccato dal sandbox; è stato eseguito un collaudo manuale attraverso il browser disponibile.

## Prossime consegne
Piano e roadmap: `docs/specs/2026-11-11-free-first.md`. Scelta API e architettura dell'autonomia: `docs/API_Gratuite_Autonomia_2026-11-11.md`. Il passo successivo è attivare e misurare un modello veramente gratuito, poi completare il verticale C1 con build firmate e installazioni. Nessuna promessa di generazione universale o superiorità prestazionale è ancora dimostrata.

Non sono stati copiati sorgenti NativeBot/Vibra. Le dipendenze hanno le rispettive licenze. Il repository è pubblico. La scelta di una licenza di riuso resta al titolare.

## Identità visiva

La [guida grafica](docs/design/README.md) raccoglie le tavole e la scelta **B · Brace** per pulsanti e icone.
