# Stato — Forgia

> Formato fisso: `gianpaolobol/registro-delle-idee` → `PROTOCOLLO_AI.md`, sezione 4. Massimo una pagina: i dettagli restano in `AGENTS.md`, Issue #7 (registro RV-01).

## Cos'è
Creatore di app di Gian: client Expo per iOS, Android e web e gateway di sviluppo Node separato.

## Fase
in sviluppo

## Dove è pubblicata
non pubblicata

## Prossimi passi
1. Eseguire npm ci, check e test completi su Node 24; ripetere DF1–DF7 (già 7/7 su Node22) e collaudare MP3–MP5 e B9 HTTP sul candidato cumulativo.
2. Collaudare provider AI locale e cloud gratuito, recupero, controllo remoto e installazioni fisiche.
3. Chiudere RV-01 (Issue #7) e verificare CI del nuovo candidato prima di ogni merge.
4. Notification Hub #61 separato: consegna reale opt-in e integrazione solo dopo review e CI.

## Blocchi
- [Codex] Ambiente Node 24 e checkout completo non disponibili; dispositivi e provider reali non verificati. Quota storage CI sconosciuta. Review indipendente pendente.

## Componenti condivisi
- Usa da altri repository: —
- Offre agli altri: Gateway AI gratuito multi-fornitore (`server/providers.ts`, `server/gateway.ts`)

## Linee guida
Segue la versione **1.1.0** (`LINEE_GUIDA.md`).

## Registro aggiornamenti
- 2026-11-26 [Claude] Prima compilazione dai contenuti del repository; le voci "da confermare" vanno verificate.
- 2026-11-28 [Codex] Riconciliazione isolata di #44 con checkpoint cumulativo F05; #52 congelata con CI storica verde, nessun rilascio.

- 2026-11-28 [Codex] Delta F05/R03: guard cache post-risposta, caratterizzazione V8 4/4 con dipendenze sintetiche; suite integrata ancora aperta.

- 2026-11-28 [Codex] DF1–DF7 eseguiti due volte, 7/7 su Node22 e SQLite reali; provider sintetici. Evidenza docs/evidence/2026-11-28-df-integrated.md. Node24/HTTP/CI/review ancora aperti.

- 2026-11-28 [Codex] B1–B8 8/8 su SQLite reale e Node22: marker di cutover quota/cache impedisce downgrade/reinizializzazione dopo perdita isolata del DB. B9 HTTP predisposto, non eseguito.
