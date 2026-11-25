# Master Portfolio Orchestrator

Il Master Portfolio Orchestrator importa il piano operativo locale con sezioni
numerate a partire da 0. Conserva testo, riferimenti originali, sequenza e SHA-256
dell'allegato. I progetti sono ordinati da P0 a P3, seguiti da quelli senza
priorità. Le sezioni sulle repository ausiliarie e sui vincoli operativi restano
direttive. I progetti assegnati ad altre sessioni possono essere letti per il
coordinamento e quelli sospesi non ricevono una presa in carico.

```sh
npm run --silent portfolio -- plan .data/portfolio-plan.md
npm run --silent portfolio -- handoff .data/portfolio-plan.md portfolio-01
npm run --silent portfolio -- models
node --env-file=.env --experimental-strip-types scripts/master-portfolio.ts key
```

Tenere il piano reale e gli output privati in `.data/`, che Git ignora.
Il comando `plan` può stampare tutti i dettagli riservati del piano. Il comando
`handoff` prepara il passaggio di consegne locale per un singolo progetto.
L'import iniziale conserva gli obiettivi anche quando il formato del testo
non consente di estrarre milestone numerate. GitHub conserva l'evidenza
operativa per SHA, PR, run e stato. L'import è in sola lettura.

## OpenRouter

Il catalogo live mostra varianti `:free` con prezzi dichiarati tutti pari a
zero, capacità di output testuale, contesto e supporto a `response_format`.
Le famiglie richieste compaiono anche senza varianti idonee. Nuovi publisher
sono rilevati senza modifiche al gateway. La selezione per l'inferenza nel
gateway esistente è un singolo ID esplicito via `OPENROUTER_MODEL`.
Per la generazione AppSpec scegliere un modello testuale con
`structuredOutput: true` e provarlo con una richiesta sintetica autorizzata.
Il gateway applica il consenso e la quota esistenti. Il modello usa un prezzo
massimo zero, con fallback del fornitore disattivato. Le richieste del
portafoglio restano locali e la coda SQLite conserva il vincolo solo locale.

In [OpenRouter Keys](https://openrouter.ai/settings/keys), verificare la chiave
`Gian-multi-AI` e impostare un tetto di 20 USD con reset mensile se manca.
Se è necessario crearla, inserire direttamente il valore nel file locale
`.env` del gateway, con permessi riservati al proprio account. Il comando
`key` interroga solo il limite e l'uso della chiave configurata e non stampa
nome, etichetta o segreto. La corrispondenza del nome va verificata
nell'interfaccia. Il saldo e la ricarica automatica si verificano in
[OpenRouter Credits](https://openrouter.ai/settings/credits). Tenere la
ricarica automatica disattivata. Il limite mensile è un tetto amministrativo.
L'uso automatico a pagamento resta disabilitato.

Le quote OpenRouter documentate per le varianti `:free` sono 20 richieste
al minuto e 50 al giorno, con soglia superiore di 1.000 richieste giornaliere
per account qualificati. Il catalogo e la scheda della chiave non espongono
il numero effettivo di richieste free ancora disponibili. Il gateway Forgia
applica separatamente il proprio limite cloud già configurato.

Vedi [backlog](PROJECT_BACKLOG.md) e [progressi](MASTER_PROGRESS.md).


## Intake Superhandy in sola lettura

Per un progetto non sospeso e non assegnato altrove, generare una baseline
compatibile con il ledger locale (esempio POSIX; usare una directory privata
già esistente e un archivio nuovo):

```sh
umask 077
npm run --silent portfolio -- superhandy .data/portfolio-plan.md portfolio-01 planner reviewer executor > .data/intake-01.json
node --experimental-strip-types scripts/superhandy.ts init intake-01 .data/intake-01.json
```

La baseline associa SHA-256 del piano originale, ID e repository esatto ai
tre task: inventario, confronto dei requisiti, matrice delle evidenze.
L'operatore conserva l'allegato originale corrispondente al digest; nessun
testo arbitrario delle milestone viene trasformato in comando. Un riferimento
ambiguo, progetto sospeso o assegnato altrove non genera una baseline.
Il revisore dichiarato deve approvare il piano prima del claim e accettare
ciascuna evidenza prima del task dipendente. Gli attori sono ancora ID
dichiarati, non account autenticati; la review indipendente resta esterna.
I task portfolio non sono AppSpec e il bridge locale li rifiuta prima di
qualsiasi chiamata. Inventario e prove richiedono operatori reali; questo
non legge GitHub automaticamente, non assegna sviluppo e non autorizza
modifiche ai repository. Non committare piano o output privati.
