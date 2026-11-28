# Backlog dei progetti

L'output del comando `portfolio plan` crea un backlog per progetto e
conserva le milestone numerate nell'ordine dell'allegato. Gli ID
`portfolio-NN-NN` identificano le voci importate da questo piano.
Il backlog operativo di ciascun repository si riconcilia con il backlog
importato usando gli ID originali, le PR, le dipendenze e i gate già definiti.
Non convertire le milestone importate in issue prima della riconciliazione.

| Fase | Criterio di accettazione |
| --- | --- |
| Analisi | Specifiche originali lette, SHA e differenze con il codice documentati |
| Pianificazione | Backlog residuo con dipendenze e test, baseline versionata |
| Review indipendente | Decisione del revisore registrata sulla stessa baseline |
| Assegnazione | Un solo scrivente, branch, perimetro, consenso e AI idonea |
| Implementazione | PR e checkpoint registrati con evidenze dei test |
| Collaudo | Test, build firmate e distribuzione documentati per piattaforma |
| Validazione | Gate e riscontri originali, autorizzazioni per le release e la commercializzazione |

Il comando `portfolio handoff` produce la scheda di analisi in sola lettura.
Le fasi successive sono requisiti del flusso Superhandy. L'assegnazione
eseguibile, il rientro con lo stesso revisore e l'audit durevole seguono
F06–F09 in [MASTER_PLAN](MASTER_PLAN.md).
