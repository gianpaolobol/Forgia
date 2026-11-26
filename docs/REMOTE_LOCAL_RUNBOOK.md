# F09 — runtime locale di stato (RC16–RC18)

Pilota solo sullo stesso computer, Node 24. Nessun comando remoto, tunnel, pubblicazione, proxy gateway o collegamento iPhone. Non è un servizio Windows installato. Non usare in CI credenziali reali.

Preparare una directory di stato **locale**, assoluta e fuori dal repository, controllata esclusivamente dall'operatore autorizzato. Su POSIX: proprietario corrente, permessi 0700. Su Windows: verificare preventivamente con gli strumenti ACL del sistema che solo l'account autorizzato e gli amministratori di fiducia possano accedere (inclusi file ereditati); il runtime non verifica le ACL Windows. Niente filesystem di rete, cartelle sincronizzate, symlink o junction. Non usare directory in cui scrivono altri utenti/processi non fidati. Un solo host e agente per directory. Backup privato, non ripristinare un vecchio contatore con un grant ancora valido.

Da terminale locale interattivo, sostituire STATE con il percorso assoluto preparato:
- node --experimental-strip-types scripts/remote-local.ts register STATE pc
- node --experimental-strip-types scripts/remote-local.ts issue STATE pc node 60
- node --experimental-strip-types scripts/remote-local.ts issue STATE pc operator 60
- node --experimental-strip-types scripts/remote-local.ts serve STATE 8791

L'emissione visualizza intenzionalmente il token una sola volta nel terminale locale: disattivare registrazione/trascrizione e condivisione schermo; trasferire privatamente al vault già autorizzato, non salvare in cronologia, repo, log o file in chiaro. Se esposto, revocare immediatamente. Nessuna integrazione vault fornita. Il comando agent STATE 8791, con lo stesso prefisso node, accetta il solo token nodo attraverso stdin non interattivo (64 caratteri esadecimali, opzionale newline, EOF); collegare soltanto un vault locale approvato tramite pipe privata. Non usare argomenti o variabili d'ambiente per i segreti. Nessun esempio con token reale.

Revoca: node --experimental-strip-types scripts/remote-local.ts revoke STATE GRANT_ID da terminale amministrativo locale. Il processo agente si arresta al primo rifiuto; un errore transitorio non equivale a stato online. Ctrl+C arresta il runtime; il server attende la chiusura delle connessioni prima di chiudere SQLite. DB control.sqlite e agent.sqlite separati; non cancellare o ripristinare i contatori mentre le credenziali sono valide. Per rollback fermare i processi e revocare i grant prima di cambiare versione; conservare i DB privati.

MFA, TLS, ACL di rete, vault integrato, pairing, installazione servizio Windows, UI e prova cellulare rimangono obbligatori prima del controllo remoto. Nessuna esposizione di 8791 o 8787. Test RC16–RC18 non equivalgono a un collaudo Windows fisico. 
