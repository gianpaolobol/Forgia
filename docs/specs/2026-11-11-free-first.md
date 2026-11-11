# Forgia: creare app con budget API zero

Nome di lavoro, da verificare prima di pubblicare. Il piano dell'8 novembre è autorizzato dallo sviluppo richiesto; questa specifica recepisce il vincolo esplicito dell'utente dell'11 novembre: nessuna API o infrastruttura a pagamento prima degli introiti. Fungo Italia è pubblicata su Apple Store secondo la conferma del titolare; gli altri casi mantengono lo stato da verificare.

## Scelta
Motore nostro sostituibile, React Native/Expo per iPhone, Android e web; modelli aperti locali tramite Ollama, Groq Free e OpenRouter limitato a modelli gratuiti come integrazioni opzionali lato server. Nessun acquisto, iscrizione a un piano pagato o fallback automatico a pagamento. Le credenziali non entrano nel client. Il funzionamento di base non richiede AI: compilatore di specifiche in sorgenti per cataloghi offline, esplicitamente distinto da generazione AI libera.

Ollama richiede hardware disponibile e una licenza del modello compatibile. Groq richiede conferma operativa di account Free; una chiave da sola non prova il piano. OpenRouter richiede modello :free e metadata prezzi zero appena controllati. Gemini non è il default: i termini consultati richiedono Paid Services per API client distribuiti agli utenti SEE; non basta la presenza del free tier. Cloudflare da valutare nel pilota, nessuna dipendenza necessaria.

## Primo incremento funzionante
Salvare idea e dati, scegliere famiglia, conservare checkpoint con backup, generare file Expo per un catalogo personalizzato con ricerca/preferiti/quiz opzionale, esportare ZIP su web e mobile. CRUD e gruppi possono essere descritti ma non consegnati con autenticazione simulata. Mostrare stati reali: bozza, sorgenti generati, non compilato, non installato. Preview di progetto distinta da beta. Nessun indicatore inventato di avanzamento.

Backend di sviluppo locale, non servizio pubblico: adapter di modelli, validazione JSON della specifica, quote dure e cache persistente. Solo chiamate a endpoint prestabiliti, modello locale privo del suffisso cloud, timeout, nessun tool di shell o codice generato eseguito. Default nessun provider configurato e solo loopback. Per una distribuzione pubblica servono account, autorizzazioni, isolamento e secret management: rimane una fase successiva.

## Prove richieste
Nessun provider pagato, sconosciuto, prezzo non verificato o locale cloud deve essere chiamato. Senza consenso niente invio cloud. Quote e cache devono sopravvivere al riavvio e concorrenti non possono superare il tetto. 429 diventa lavoro sospeso, non successo. JSON invalido non modifica il progetto. Storage danneggiato recupera l'ultimo backup integro, o blocca senza sovrascrivere. Generazione rifiuta dataset incompleto e non cambia il numero di elementi. Quiz vuoto rifiutato. Prove su web a larghezza desktop e iPhone; non equivalgono a collaudo fisico nativo.

## Roadmap completa
1. Questo incremento: fondazioni, generatore offline, provider sostituibili, test e sorgenti esportabili.
2. Attivare almeno un account realmente gratuito o un computer Ollama esistente; misurare correttezza, latenza, correzioni, contesto e consumo su C1/C2/C3. Nessuna parità prestazionale promessa prima delle prove.
3. Verticale C1 firmato iOS/Android, installazione pulita e offline; percorso CI entro quote già disponibili, nessun runner cloud pagato.
4. Auth e CRUD veri, isolamento utente e secondo dispositivo; poi gruppi, ruoli, revoca e concorrenza.
5. Sandbox isolate, ripresa job, artifact hash, pipeline di verifiche e beta del cliente. Vietato eseguire codice non fidato sul server di controllo.
6. Tre piloti assistiti con budget zero e capacità limitata; se quote esaurite mettere in coda, mai eludere limiti con account multipli.
7. Pubblicazione del creatore e assistenza store ai clienti; accessi e costi store del titolare distinti dal consumo AI. Desktop e sistemi alternativi dopo test dedicati.
8. Solo dopo decisione del titolare e ricavi: nuovo adapter con consenso esplicito, plafond economico e rendiconto. Non basta cambiare un toggle per attivare fatturazione.
