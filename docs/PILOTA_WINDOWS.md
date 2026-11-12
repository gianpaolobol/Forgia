# Forgia sul PC Windows, solo per il collaudo

Il PC ospita Ollama e il gateway HTTPS per il tempo della prova. I due telefoni devono essere collegati alla stessa rete privata del PC. Il kit usa il modello locale Qwen 2.5 1.5B e limita la regola del firewall al profilo privato e alla sottorete locale.

## Avvia il gateway

1. Se mancano, installa [Node.js 24](https://nodejs.org/en/download) e [Ollama per Windows](https://ollama.com/download/windows). Poi apri una nuova finestra di PowerShell.
2. Estrai tutto lo ZIP e apri PowerShell nella cartella estratta che contiene `scripts`.
3. Esegui questo comando. La prima esecuzione scarica il modello e Windows chiede l'autorizzazione per la regola temporanea del firewall.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Avvia-Pilota-Forgia.ps1
```

Se il PC ha più interfacce private, aggiungi `-Indirizzo` seguito dall'IPv4 indicato per la rete condivisa con i telefoni. Il gateway ascolta solo su quell'indirizzo, sulla porta 8443.

Quando compare **Gateway attivo**, lascia aperta la finestra e allega in chat i due file della cartella `Da-allegare`. Sono il certificato pubblico e l'indirizzo del PC. Conserva i due codici tester mostrati nella finestra per inserirli nelle rispettive app. I codici durano otto ore e vengono sostituiti al riavvio.

## Prova le build pilota

La build deve ricevere l'origine HTTPS in `EXPO_PUBLIC_FORGIA_PILOT_URL` e il percorso al certificato pubblico in `FORGIA_LAN_PILOT_CA`. Android integra il certificato solo per l'indirizzo indicato e usa un identificativo dedicato al collaudo. Su iPhone installa il certificato pubblico del pilota, poi abilita l'attendibilità SSL/TLS in **Impostazioni → Generali → Info → Impostazioni attendibilità certificati**. Quando Forgia lo chiede, consenti l'accesso alla rete locale. [Istruzioni Apple](https://support.apple.com/it-it/102390)

Nella build pilota apri **Motori AI**, inserisci il codice del telefono e premi **Verifica gateway pilota**. Poi crea un progetto sintetico e chiedi due revisioni. Registra esito, dispositivo e versione della build.

## Spegni e rimuovi il pilota

Premi **Invio** nella finestra del gateway. Conferma l'eventuale richiesta di Windows per la rimozione della regola firewall. Puoi riavviare lo stesso certificato, finché è valido, per riprendere le prove con la stessa build.

A fine collaudo esegui anche:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Avvia-Pilota-Forgia.ps1 -Pulisci
```

Il comando elimina la sessione e la relativa regola firewall. Rimuovi anche il certificato dall'iPhone e disinstalla la build Android dedicata.
