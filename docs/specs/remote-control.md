# Forgia Remote Control — specifica iniziale
## Obiettivo
Client Expo/web mobile per impartire istruzioni al nodo Windows AERO 15, consultare attività persistenti e approvare operazioni. Estendibile a più nodi. Nessun acquisto necessario per il pilot.
## Architettura
Mantenere gateway esistente su loopback: non esporre la porta 8787. Nuovo servizio separato, raggiungibile solo via rete privata Tailscale, HTTPS, autenticazione individuale e autorizzazione per nodo/progetto; niente port forwarding o Funnel. Client web mobile servito sulla stessa origine privata. Non riutilizzare le deleghe non ancora implementate come autenticazione. Credenziali nel vault locale, mai nel repository pubblico. Accesso desktop separato e opzionale.
## Iterazioni
1. Inventario Windows, GPU, RAM, rete, misura consumi; pairing iPhone e PC con MFA e ACL ristrette.
2. Servizio autenticato con stato nodo, heartbeat e coda SQLite persistente; idempotenza, annullamento, recupero dopo crash senza rieseguire automaticamente effetti esterni.
3. UI Forgia mobile: nodi, progetti, dettatura tramite tastiera iOS, invio, cronologia, log redatti, approvazioni, arresto.
4. Adapter Ollama locale e provider gratuiti già esistenti; Claude Code e Codex solo con accessi autorizzati, verifica disponibilità e quote; API a pagamento disattivate finché autorizzate separatamente. Nessun aggiramento quote.
5. Worker non amministratore, workspace per progetto, sandbox, strumenti esplicitamente consentiti; niente shell arbitraria via HTTP. Modifiche su branch dedicati; conferma per push, merge, pubblicazioni, invio dati esterni e operazioni distruttive. Nessuna spesa automatica.
6. Avvio controllato con Windows, schermo spento, sospensione solo a coda vuota e dopo verifica Wake-on-LAN; eventuale nodo a basso consumo in seguito.
## Collaudo obbligatorio
iPhone su rete cellulare: invio attività, chiusura browser, completamento sul PC, riconnessione e risultato. Test accesso non autorizzato, revoca, CSRF, isolamento progetti, prompt injection, quote, crash/restart, cancellazione e assenza di segreti nei log. Verificare che gateway precedente resti locale. Misurare consumo a riposo e sotto carico. Nessuna dichiarazione di operatività prima del test reale.
## Stato
Specifica iniziale, non implementazione né installazione. Nessun indirizzo privato o dato di accesso in questo repository pubblico.
