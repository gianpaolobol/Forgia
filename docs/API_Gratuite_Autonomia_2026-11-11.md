# Forgia: scelta delle API gratuite e autonomia

Il vincolo del titolare è zero spesa iniziale. Una futura integrazione a pagamento deve poter essere aggiunta senza riscrivere i progetti, ma non è autorizzata ora. Non è dimostrato che l'insieme delle quote gratuite possa sostenere un servizio pubblico illimitato: iniziamo con un pilota limitato e sospendiamo i lavori a quota esaurita.

## Confronto verificato l'11 novembre 2026

| Sistema | Utilità per noi | Limite concreto | Decisione |
|---|---|---|---|
| Ollama + modello aperto locale | Nessuna tariffa di inferenza API; controllo dell'ambiente e possibilità di lavorare senza inviare idee al cloud | Servono RAM, calcolo ed energia già disponibili; licenza da verificare per ciascun modello. In questo ambiente Ollama non è installato | Adapter scritto, nessun download pesante o nuovo hardware acquistato |
| Groq Free | Esecuzione di modelli aperti senza mantenere GPU nostre | Quote per organizzazione e modello; l'upgrade Developer abilita fatturazione, quindi serve account realmente Free | Adapter scritto, obbligo di attestare piano Free; nessuna chiave collegata |
| OpenRouter modelli :free | Accesso alternativo a modelli gratuiti senza fissarsi su un solo produttore | Disponibilità e limiti variabili; qualità dipendente dal modello; non usare il routing a pagamento | Adapter scritto, modello esplicito :free, controllo preventivo dei prezzi zero; nessuna chiave collegata |
| Cloudflare Workers AI Free | Possibile integrazione successiva di modelli e infrastruttura | Allocazione gratuita di 10.000 neuroni/giorno, che non equivale a 10.000 richieste. Alcuni modelli richiedono pagamento | Valutato, non necessario nel primo incremento e non integrato |
| Gemini API Free | Potenzialmente utile per sperimentazione personale | I termini attuali distinguono il free tier dalla distribuzione di API client agli utenti SEE, per cui richiedono Paid Services. Non basta leggere il listino gratuito | Escluso dal percorso gratuito iniziale del prodotto per utenti italiani |
| GitHub Models | Era una possibile opzione di prototipazione | La documentazione ufficiale consultata dichiara il servizio ritirato dal 30 luglio 2026 | Escluso; GitHub resta utile per sorgenti e CI, non come inferenza gratuita presunta |

Le quote non vanno sommate come capacità garantita: modelli, contesti e condizioni sono diversi. Nessuna rotazione di account per eludere i limiti. Gli abbonamenti consumer di un servizio non vengono trattati come API gratuite da automatizzare.

## Come competere senza acquistare il modello più costoso

La scelta migliore non è ancora un singolo vincitore dimostrato. Il primo esperimento utile confronta un modello adatto alla scrittura di codice in locale (famiglia Qwen3-Coder, se l'hardware lo consente) con modelli disponibili nel piano gratuito Groq e modelli :free selezionati su OpenRouter. Non li dichiariamo equivalenti ai modelli a pagamento prima delle prove.

L'architettura riduce la quantità di generazione libera necessaria: il modello prepara una specifica strutturata, validata dal nostro codice; moduli controllati generano la base; richieste piccole e correzioni mirate potranno estendere il risultato. Il modello non riceve chiavi e non esegue comandi sul computer di controllo. Nel primo incremento è operativo il compilatore di cataloghi da campi strutturati; non è ancora un agente capace di generare software arbitrario da una frase.

Misurare C1/C2/C3 con lo stesso input, dataset e controlli: correttezza al primo tentativo, correzioni necessarie, tempo totale, memoria, output troncati, richieste/tokens, sospensioni per quota e minuti di intervento umano. Scegliere il fornitore in base al risultato verificato per il compito, non al numero di parametri dichiarato. Conservare modello e versione usati per ogni revisione.

## Contratto del motore già implementato

- Interfaccia del provider indipendente dal progetto; nessun servizio a pagamento registrato.
- Locale distinto dal cloud, consenso richiesto per quest'ultimo. Endpoint fissati nel server, non ricevuti dall'utente.
- OpenRouter controlla metadata e modelli :free; se i prezzi sono assenti o non zero, blocca prima di inviare il prompt.
- Groq richiede conferma di Free: il codice non può dedurre il piano da una chiave. Se in futuro il titolare cambia il piano sul sito del fornitore, va riconfigurato e verificato il collegamento. La garanzia operativa zero spesa richiede anche che non sia attivata fatturazione nell'account.
- Quota applicativa prudenziale di 20 richieste/giorno/fornitore, non presentata come limite del vendor; contatore persistito prima della chiamata, cache solo dopo validazione, nessun retry illimitato o ripiego pagato.
- Errori, output incompleti e JSON invalidi non diventano progetti riusciti. Timeout e limiti della richiesta riducono lavoro incontrollato.
- Il gateway è un servizio locale di sviluppo, non un backend multiutente pubblicabile. Prima dell'esposizione servono identità, isolamento, code durevoli, gestione segreti e controlli operativi.

## Input verbale e iterazioni

Il percorso previsto è racconto → specifica → prima bozza → feedback → revisione → verifica. Il testo iniziale può essere dettato con la tastiera del dispositivo; questa versione non registra audio né integra una trascrizione propria. Un futuro trascrittore locale potrà diventare un altro adapter, senza imporre API vocali a pagamento.

Ogni revisione conserva istruzione, specifica e data; il ripristino aggiunge una versione senza cancellare le precedenti. Con il modello collegato, la richiesta di modifica passa insieme alla specifica corrente. Senza un modello configurato, l'utente modifica i campi: il sistema non finge di capire un'istruzione libera. È previsto un passaggio successivo per proposte/diff verificabili e punti di controllo automatici sull'ambito modificato.

## Autonomia degli account: architettura da integrare

La richiesta di autonomia totale diventa un insieme di deleghe concrete, non la raccolta di tutte le password. Per API: OAuth con scope limitati o chiave dedicata. Per browser: sessione isolata per utente e servizio, accesso iniziale tramite procedure consentite, revoca e tracciamento. I cookie di sessione hanno valore di credenziali e richiedono la stessa protezione delle chiavi. Un vault conserva segreti; il progetto mantiene solo riferimenti opachi.

Il controllo di policy predisposto verifica servizio, scope, scadenza, revoca, riferimento a credenziale e costo zero. Questo controllo non è un connettore OAuth o un vault funzionante: nessun account è attualmente controllato da Forgia. Per applicarlo davvero, ogni azione del futuro esecutore deve passare dalla policy; non deve esistere un accesso diretto alternativo.

Le passkey non sono password da esportare. La presenza del titolare, MFA, CAPTCHA o conferme di un fornitore possono interrompere una delega: stato «richiede presenza» e ripresa dal checkpoint. Non si promette di eliminare richieste esterne che non controlliamo e non si aggirano le protezioni. Obiettivo misurabile: minimizzare interventi umani conservando limiti e prova delle azioni.

Pagamenti futuri: commerciante e scopo autorizzati, tetto per operazione/progetto/periodo, separazione fra una tantum e rinnovi, nessun aumento tacito. Usare strumenti del prestatore di pagamento e deleghe/token; non dare numeri di carta al modello o conservarli nella chat. Alcuni pagamenti richiedono comunque conferma del titolare. Ora tutti gli acquisti sono bloccati: la richiesta descrive una capacità futura, non annulla il vincolo di spesa iniziale zero.

## Confini economici

Un modello aperto non fornisce GPU gratis; API gratuita non significa capacità illimitata. Firme, account store e runner iOS possono avere costi separati, oppure usare risorse già possedute e quote esistenti. Non attiviamo nuovi addebiti. Quando una fase non è possibile entro le risorse disponibili, resta sospesa e dichiarata, non sostituita con un risultato inferiore nascosto.

## Fonti primarie

- Groq quote e modelli: https://console.groq.com/docs/rate-limits
- Groq Free/Developer: https://console.groq.com/docs/billing-faqs
- Groq protocollo: https://console.groq.com/docs/openai
- OpenRouter limiti: https://openrouter.ai/docs/api-reference/limits
- OpenRouter modelli gratuiti: https://openrouter.ai/collections/free-models
- Ollama API locale: https://docs.ollama.com/api/chat e https://docs.ollama.com/faq
- Modelli coding aperti: https://github.com/QwenLM/Qwen3-Coder
- Cloudflare quote: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Gemini termini: https://ai.google.dev/gemini-api/terms
- GitHub Models: https://docs.github.com/en/github-models

Ricerca documentale e deduzioni architetturali, non benchmark di qualità dei modelli. Nessuna richiesta di inferenza reale né nuovo piano pagato effettuati in questa sessione.
