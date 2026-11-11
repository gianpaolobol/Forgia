# Verifiche del primo incremento — 11 novembre 2026

## Eseguite
- 35 test Node sul dominio, sorgenti esportati, persistenza, revisioni, deleghe, gateway e adapter. Tutti superati nell'ultima esecuzione registrata.
- Controllo TypeScript dell'app creatrice e del progetto estratto dallo ZIP: superato.
- Esportazione Metro web e bundle Hermes Android/iOS per il creatore e per l'esempio estratto: riuscita. Sono bundle JavaScript, **non build native firmate**.
- Browser reale tramite CUA: specifica gestionale senza schede salvata sul pannello privato e generazione correttamente disabilitata; rifiuto catalogo senza schede; salvataggio di sei schede; modifica del nome con istruzione; ricaricamento e persistenza; ripristino r1 che aggiunge r3; generazione di dieci file; download ZIP verificato ed estratto; stati AI e account scollegati mostrati correttamente.
- Revisione indipendente del codice e correzioni con regressioni prima fallite e poi superate: quota con contatori array, backup durante recupero interrotto, preservazione dati nelle proposte AI, delimitatori nei nomi, mutazioni concorrenti, prezzi gratuiti vuoti e salvataggio requisiti delle famiglie future.

## Non eseguite / limiti
- Nessuna inferenza AI reale e nessuna misurazione comparativa delle prestazioni dei modelli gratuiti.
- Nessuna installazione iPhone/Android fisica, nessuna IPA/AAB, nessun caricamento TestFlight/Play Store.
- Esportazione ZIP nativa implementata, non provata su telefono.
- Test Playwright automatici predisposti ma non eseguiti con esito positivo: il browser locale non può avviarsi nel sandbox (socket non permesso). Tre test falliti prima dell'esecuzione delle interazioni; non tre difetti funzionali osservati. Il collaudo browser sopra è manuale tramite la superficie consentita. Nessuna certificazione di layout mobile a 390px.
- Gateway verificato con fixture HTTP, non con account cloud. Persistenza e concorrenza riferite a un solo processo locale, non a un cluster.
- OAuth, vault e controllo browser cliente solo progettati; policy testata separatamente, non prova di deleghe attive.
- Nessun audit di sicurezza completo né prova degli altri cinque repository svolti in questo incremento.

## Esito
Prima base di sviluppo utilizzabile per specifiche, revisioni e generazione di cataloghi da campi strutturati. Non ancora servizio autonomo universale da descrizione libera, né prodotto pronto alla distribuzione nativa. Nessun nuovo servizio a pagamento acquistato; nessuna API di inferenza chiamata.
