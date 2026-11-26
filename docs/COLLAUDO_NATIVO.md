# Collaudo nativo di Forgia

Usare un’installazione pulita per il primo giro. Annotare piattaforma, modello,
versione del sistema, versione di Forgia, commit e passaggio in cui compare
l’eventuale errore.

| Passaggio | Risultato atteso |
| --- | --- |
| Apri Forgia in modalità aereo | Si apre la pagina Progetti. |
| Crea un catalogo, usa i dati di esempio e salva | Il catalogo compare nella lista con sei schede. |
| Modifica il nome e salva una nuova versione | La cronologia contiene la bozza iniziale e la modifica. |
| Chiudi e riapri Forgia, poi ripristina la prima versione | Il catalogo è ancora presente. Il ripristino aggiunge una versione. |
| Esporta i sorgenti e scegli Condividi ZIP | Il sistema apre la condivisione. Il file salvato contiene i sorgenti Expo e il dataset. |
| Prova a salvare un catalogo senza schede | Forgia mostra il messaggio di validazione e conserva i progetti già salvati. |

## Build e distribuzione

- **Android fisico ARM64.** Scaricare l’APK di collaudo dagli artefatti
  del workflow GitHub Actions quando il job Android è completato. La firma
  debug consente l’installazione diretta sui dispositivi compatibili.
- **iOS Simulator.** Estrarre l’app dal corrispondente artefatto del workflow
  e installarla in un simulatore avviato con `xcrun simctl install booted Forgia.app`.
- **iPhone fisico.** Usare il profilo EAS `ios-testflight` con un progetto
  Expo collegato, credenziali Apple autorizzate e una quota di build gratuita
  disponibile. La build firmata deve poi essere elaborata da App Store Connect
  prima dell’assegnazione a un gruppo TestFlight.

Il primo collaudo nativo copre bozza, revisioni e condivisione offline.
Il collaudo dell’AI sul telefono usa la [configurazione pilota](PILOTA_MOBILE.md).
Per il pannello web usare la demo locale descritta nel README.

## Pacchetti per gli store

Il workflow GitHub Actions genera anche `Forgia-ios-unsigned-xcarchive` per
iPhone fisico e `Forgia-android-unsigned-aab`. La firma viene applicata con
le credenziali dedicate di Forgia. Gli artefatti senza firma sono intermedi.

- **TestFlight.** Registrare il Bundle ID `it.gianpaolofranceschini.forgia`,
  creare la scheda Forgia in App Store Connect e usare un certificato Apple
  Distribution e un profilo App Store Connect per esportare un IPA firmato.
  Caricare l’IPA e assegnare la build elaborata al gruppo di test interno.
- **Play Console.** Firmare l’AAB con la chiave di caricamento di Forgia
  tramite `jarsigner` e verificare la firma prima di caricarlo in Test interni.
  Conservare la chiave per le build successive.
