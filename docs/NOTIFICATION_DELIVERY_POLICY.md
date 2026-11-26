# F14 / N2 — policy di consegna locale (26 novembre 2026)

Lotto isolato da PR #49, base fa4079764aff1b75ad6d4a302ef39025e3e53c23. Issue #46. F09/#52 e CI cumulativa non modificati. RV-01 non eseguita.

- Quiet hours opzionali per owner e canale, espresse esplicitamente in minuti UTC (non orario civile/DST); intervallo semiaperto, anche a cavallo di mezzanotte. Critici esclusi dal silenzio ma non dal pacing.
- Pacing per owner/canale: almeno 1000 ms di default, configurabile fino a 24 ore. Riserva SQLite nella transazione di send intent; recheck al begin, anche se la policy cambia tra claim e dispatch. Clock arretrato non anticipa la consegna. Nessun tentativo consumato se deferito.
- Persistenza additiva, nessuna migrazione distruttiva. Un crash dopo send intent continua a non autorizzare replay. Il pacing non sostituisce i limiti globali del provider o quelli di account.
- Non è API autenticata, UI, digest aggregato, webhook, vault, prova gratuita esterna o integrazione Telegram/email/push. Non usare credenziali reali o esporre endpoint. Nessun invio a terzi.

## Matrice
| Caso | Evidenza prevista | Stato |
|---|---|---|
| Silenzio UTC, attraversamento mezzanotte e criticità | test N2 quiet hours | predisposto |
| Due worker, riapertura DB, rollback orologio, isolamento | test N2 persistent dispatch pacing | predisposto |
| Cambio policy dopo claim, input invalido, revoca | test N2 policy change | predisposto |
| N1/N2 regressioni | test notification-hub/delivery | da eseguire |

Eseguire npm ci, npm run check, npm test su candidato coordinato dopo review; test isolato Node 24: node --experimental-strip-types --test tests/notification*.test.ts. Non dichiarare PASS prima dei log. Clone locale in questa esecuzione impedito da DNS. Rollback: fermare i worker, preservare database e sidecar privati, non riattivare lease incerti; mantenere il codice precedente solo dopo verifica che non perda le policy richieste (altrimenti sospendere consegne). Digest, rate cap globale provider, timezone civile e canali reali ancora aperti.
