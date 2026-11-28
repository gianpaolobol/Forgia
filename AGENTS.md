# Continuità Forgia

<!-- inizio-protocollo-comune -->
## [Gian] Protocollo comune — gestito dalla sincronizzazione, non modificare

Questo repository fa parte della piattaforma di Gian Paolo Franceschini.

1. **Leggi prima `LINEE_GUIDA.md`** (nella radice): struttura, regole e protocollo validi per tutti i progetti. Poi questo file, comprese le deroghe `[Gian]`, poi `STATO.md`.
   Poi il **giro di controllo** (cap. 8 delle linee guida): leggi l'ultimo diario del registro e la mappa dei collegamenti, e riusa ciò che esiste già in altri repository.
2. **Firma tutto ciò che aggiungi:** `[Codex]`, `[Claude]`, `[Gemini]`, `[Copilot]`, `[Gian]`.
3. **Questo file si aggiunge, non si riscrive:** nuova sezione `## [Firma] Titolo — AAAA-MM-GG`; per superarne una scrivi una `Rettifica`.
4. **Aggiorna `STATO.md`** nella stessa pull request del lavoro.
5. **Deroghe** alle linee guida: solo Gian, in una sezione `## [Gian] Deroghe alle linee guida` di questo file.
<!-- fine-protocollo-comune -->


Leggere README.md, CONTINUITA.md e docs/specs/2026-11-11-free-first.md prima di modificare.
Vincolo utente: zero nuovi costi API/infrastruttura iniziali. Vietati upgrade o fallback pagati. Nessuna chiave nel client o nei commit.
Non chiamare beta un'anteprima o un bundle JS. Tenere distinte prove automatiche, browser, native e sul modello reale.
Questo è un progetto mobile Expo con pannello web statico. Preservare la struttura nativa e il motore indipendente dal provider.
Il servizio server è locale di sviluppo, non pubblicabile come backend multiutente. Non esporlo con un tunnel.
L'accesso ospitato è privato: non cambiarne la visibilità senza richiesta. Non incorporare dati o credenziali degli altri cinque progetti.
