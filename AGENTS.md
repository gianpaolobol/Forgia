# Continuità Forgia

Leggere README.md, CONTINUITA.md e docs/specs/2026-11-11-free-first.md prima di modificare.
Vincolo utente: zero nuovi costi API/infrastruttura iniziali. Vietati upgrade o fallback pagati. Nessuna chiave nel client o nei commit.
Non chiamare beta un'anteprima o un bundle JS. Tenere distinte prove automatiche, browser, native e sul modello reale.
Questo è un progetto mobile Expo con pannello web statico. Preservare la struttura nativa e il motore indipendente dal provider.
Il servizio server è locale di sviluppo, non pubblicabile come backend multiutente. Non esporlo con un tunnel.
L'accesso ospitato è privato: non cambiarne la visibilità senza richiesta. Non incorporare dati o credenziali degli altri cinque progetti.
