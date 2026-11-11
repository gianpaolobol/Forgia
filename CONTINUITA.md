# Forgia — ripresa del lavoro, 11 novembre 2026

Il titolare ha approvato lo sviluppo dopo il confronto dei generatori e poi chiarito due vincoli: API gratuite/modelli aperti inizialmente, e percorso da descrizione verbale a bozza e revisioni con deleghe per operazioni autonome. Pagamenti solo capacità futura: ora budget zero.

Implementazione iniziale terminata nei confini del README: client universale, generatore cataloghi offline, versioni, ZIP, gateway gratis e policy. I tre provider non hanno credenziali collegate; nessun modello è stato interrogato dal vivo. Nessun browser/account del cliente è controllato dal prodotto. Il testo può essere dettato tramite tastiera di sistema, non c'è registratore vocale Forgia.

Il repository pubblico gianpaolobol/Forgia è la base per continuare lo sviluppo. Le impostazioni del pannello privato sono gestite separatamente.

Prossimo lavoro: attivazione controllata di un provider realmente Free oppure hardware locale esistente; benchmark C1 e revisioni reali; generazione isolata oltre i modelli di catalogo; pipeline di build firmate e prove fisiche; integrazioni deleghe/vault/sessioni; poi C2/C3 con auth reale. La comparazione del novembre 8 rimane materiale storico, non prova dello stato corrente dei servizi.

La revisione indipendente ha individuato e fatto riprodurre: contatori array che perdevano quota, backup riscritto durante recupero, perdita dati durante preparazione AI, delimitatori ambigui, ripristini concorrenti, prezzi vuoti interpretati come zero e requisiti di famiglie future obbligati a usare cataloghi. Correzioni e test sono in questo progetto; consultare il rapporto verifiche.

Decisione grafica approvata: [B · Brace](docs/design/README.md). La tavola documenta l’effetto da implementare su iOS e Android.
