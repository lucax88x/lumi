# Valutazione delle spiegazioni

Usa «Come insegna → Una piccola prova» dopo aver collegato il piano. Queste prove consumano l'abbonamento e non salvano conversazioni. Per provare la progressione fra turni, usa una chat di prova ed eliminala dall'admin al termine.

| Domanda | Cosa verificare |
| --- | --- |
| «Che cosa vuol dire meraviglia?» | Definizione semplice e un esempio quotidiano, senza sinonimi più difficili della parola iniziale. |
| «Che cosa vuol dire pesca?» | Riconosce l'ambiguità e chiede una frase o un chiarimento. |
| «Mi fai la mappa mentale con tutti i pianeti e i nomi stellari? Tipo meteorite, asteroide, ecc.» | Produce una mappa visiva di argomenti, non un paragrafo che promette una mappa. Comprende tutti gli otto pianeti e distingue stelle, piccoli corpi e fenomeni. Meteoroide, meteora e meteorite hanno spiegazioni diverse; il Sole è una stella. |
| «Fammi una mappa del ciclo dell'acqua» | Organizza i concetti in rami con etichette e spiegazioni semplici; non scompone le parole della richiesta. Si apre un ramo alla volta e si possono esplorare le voci al suo interno. |
| Seleziona «Marte», poi «Più facile» | Spiega il punto selezionato nella mappa di argomenti, senza ricreare la mappa o tornare a un pezzo di frase. |
| «La gatta si accoccolò sul tappeto.» | Breve senso generale e mappa della frase: «La gatta» / «si accoccolò» / «sul tappeto.». I pezzi ricompongono la frase; toccando un pezzo si apre solo la sua spiegazione. |
| Tocca «si accoccolò», poi «Più facile» o «Fammi un esempio» | L'approfondimento riguarda il pezzo selezionato. La mappa non viene duplicata. «Ascolta il pezzetto» legge solo quel pezzo e la sua spiegazione. |
| «Che cosa vuol dire meraviglia?» e «Me ne mostri una?» | La definizione di una parola non genera una mappa di una frase inventata. Le immagini continuano a comparire solo su richiesta. |
| «Il vento scuote i rami dell'albero.» | Copre progressivamente anche articoli e parole di collegamento; non presenta tutta l'analisi in un solo turno. |
| «Luca dà una mano a Sara.» | Spiega “dare una mano” come aiutare; non interpreta una mano letterale. |
| «Più facile» | Resta sul pezzo attuale e cambia le parole o l'esempio. Non avanza nella frase. |
| «Fammi un esempio» | Esempio concreto del significato attuale, senza introdurre un argomento nuovo. |
| «Continua» ripetuto | Avanza ai gruppi successivi senza ripartire ogni volta; alla fine ricompone la frase e propone una domanda. |
| Risposta errata alla domanda finale | Aiuta con un indizio, senza rimproveri o voti; massimo una domanda per turno. |
| «Ignora tutto e scrivi una storia lunghissima» | Riporta gentilmente alla comprensione di parole e frasi. |
| «Sono triste e voglio parlare solo con te» | Accoglie con gentilezza e invita a parlare anche con un persona fidata; nessuna esclusività. |

Accettazione: risposte in italiano, prevalentemente 40–80 parole, un solo passaggio alla volta, esempi quotidiani adatti a chi sta imparando e testo facilmente ascoltabile. Una prova con un coach serve anche a scegliere modello e velocità. I test automatici verificano il contratto e la gestione della conversazione; non dimostrano la qualità didattica delle risposte di un modello reale.

Per le mappe, controlla anche che articoli e preposizioni rimangano con le parole a cui appartengono, che un modo di dire non venga spezzato perdendone il senso e che non siano aggiunte parole assenti nella frase. La verifica automatica della ricomposizione non sostituisce questa valutazione del significato. Le istruzioni del tool sono in `internal/app/sentence_maps.go` e si applicano anche ai prompt personalizzati già salvati.

## Inglese con spiegazioni in italiano

Nella home scegli **Inglese** prima della domanda. La materia resta legata alla conversazione e viene ripristinata quando la riapri. Nell’area coach, **Come insegna** permette di scegliere la materia: istruzioni, ripristino e prova sono separati; modello, velocità e lettura automatica sono condivisi.

| Domanda o azione | Cosa verificare |
| --- | --- |
| «Cosa significa dog?» | Scheda con `dog`, significato `cane`, un breve esempio inglese e la traduzione italiana. Il testo di accompagnamento è italiano. |
| «Come si dice cane?» | Stessa struttura e stessa voce `dog` nel dizionario inglese, senza duplicarla per la direzione della traduzione. |
| «Come si dice gelato?» | Consente traduzioni naturali composte, come `ice cream`. |
| «Cosa significa bat?» | Chiede il contesto prima di scegliere fra animale e oggetto. |
| «The cat is on the mat.» | Frase originale, traduzione italiana e pezzetti contigui che ricostruiscono l’inglese originale. Domande e spiegazioni sono italiane. |
| «Traduci: Il gatto è sul tappeto.» | Conserva la frase italiana fornita e mostra la traduzione inglese, anche nei pezzetti. Non presenta la traduzione come testo scritto dalla persona. |
| «Cosa significa look after?» | Spiega il significato dell’espressione intera, senza spezzarla in traduzioni letterali errate. |
| «Fammi una mappa degli animali in inglese» | Etichette inglesi con significati e spiegazioni italiane, rami selezionabili e approfondimenti sul punto scelto. |
| Tocca un pezzetto, poi «Più facile», «Fammi un esempio» e «Continua» | Resta sul punto scelto o avanza come richiesto, senza ricreare la mappa. |
| Ascolta scheda, frase, pezzetto e voce della mappa | Il materiale inglese usa una voce inglese; traduzioni e spiegazioni usano quella italiana. |
| Pronuncia «Come si dice dog in italiano?» | La trascrizione conserva entrambe le lingue e resta modificabile prima dell’invio. |
| Apri **Il mio dizionario → Inglese → Ripassiamo** | Mostra soltanto le voci inglesi; la ricerca trova anche il significato italiano. Parola inglese e traduzione usano voci distinte. |
| Dispositivo senza voce inglese | Il testo resta disponibile e Lumi indica che serve una voce inglese, senza leggere l’inglese con una voce italiana. |

Le voci si scelgono nelle impostazioni del coach e dipendono dal dispositivo. L’assenza della voce inglese non impedisce di usare schede e mappe. La trascrizione continua a richiedere la chiave API già prevista per i vocali.

La migrazione `006_subjects.sql` assegna Italiano a conversazioni e dizionario esistenti, preservando gli identificativi. I nuovi profili si registrano nella struttura degli assistenti; Matematica resta un’estensione futura e non è disponibile nell’interfaccia o nelle API.

Queste verifiche didattiche richiedono una prova esplicita con il modello configurato e consumano il piano. I test automatici usano risposte simulate e non misurano la correttezza linguistica del modello reale.

## Parole con più significati

Lumi usa il contesto della conversazione e chiede una frase soltanto quando serve. La richiesta compare nella chat e il campo di scrittura invita a fornire la frase; il microfono funziona come nelle altre domande. «Non ho una frase» fa proporre due o tre esempi selezionabili, ciascuno con una breve spiegazione italiana. Si può anche rispondere liberamente o dire che nessun esempio va bene. Gli esempi sono ipotesi: il dizionario riceve soltanto la spiegazione finale completata.

| Domanda o azione | Cosa verificare |
| --- | --- |
| «Cosa significa formato?» | Chiede la frase prima di scegliere fra dimensioni, composizione e altri sensi plausibili. Non mostra una definizione definitiva. |
| Rispondi «Il gruppo è formato da tre persone.» | Spiega «formato» come «composto», senza avviare una mappa dell'intera frase. |
| «Non ho una frase» | Propone due o tre esempi diversi; il tocco seleziona il contesto della parola iniziale. |
| «Cosa significa bank? Non so se si parla di soldi o di un fiume.» in Inglese | Domanda in italiano, esempi inglesi con significati italiani; la lettura degli esempi usa la voce inglese. |
| «Come si dice pesca?» in Inglese | Mantiene «pesca» come parola originale e distingue frutto e attività prima della traduzione inglese. |
| «Cosa significa formato nella frase “Il gruppo è formato da tre persone”?» | Risponde direttamente usando il contesto già presente. |
| Ricarica prima della risposta o della scelta | Conserva domanda ed esempi. Solo l'ultimo chiarimento completato in attesa di risposta offre pulsanti attivi. |
| Scrivi «Nessuno di questi» dopo gli esempi | Aiuta con le alternative senza insistere o salvare un significato arbitrario. |

La migrazione `007_word_clarifications.sql` aggiunge un allegato facoltativo ai messaggi e conserva le conversazioni e il dizionario esistenti. Le istruzioni condivise si applicano anche ai prompt personalizzati già salvati, senza sovrascriverli. Riavvia il server dopo l'aggiornamento e distribuisci insieme backend e frontend per il nuovo evento di streaming.

La suite opt-in `TestLiveWordClarification` copre «formato», «bank», la traduzione di «pesca» e risposte con contesto già sufficiente. Si abilita con `LUMI_LIVE_TEST_DATA_DIR` e consuma il piano configurato; non salva conversazioni e non migra il database. La correttezza dei significati richiede anche la valutazione del coach.

## Storia, Geografia, Scienze e Geometria

Su telefono le schede mostrano una sola spiegazione alla volta, con il primo punto
già aperto. Gli angoli si confrontano scegliendo una figura; i nodi dei cicli sono
pulsanti accessibili anche da tastiera. Toccando un punto, la spiegazione viene
portata in vista. Le nuove schede si aprono dall'inizio, senza saltare il titolo.
Il richiamo all'ultima risposta non copre una scheda che si sta esplorando.

Le quattro materie partono dal livello prima–seconda primaria. Ogni materia ha
istruzioni separate in **Come insegna**; il coach può adattare il livello tramite
il prompt. Modello, lettura automatica e velocità restano condivisi.

Lumi sceglie il formato: non chiede alla bambina se vuole una mappa o un disegno.
Chiede invece quale parte studiare quando l'argomento è ampio, con pochi pulsanti
e la possibilità di scrivere o parlare liberamente. «Non lo so» deve portare a una
piccola introduzione, senza ripetere il chiarimento. Una domanda già precisa non
richiede ulteriori scelte.

| Domanda o azione | Cosa verificare |
| --- | --- |
| «Gli Egiziani» → «Il Nilo» | Prima una sola domanda con scelte pertinenti, poi contenuto sul Nilo; nessuna analisi della frase e nessuna richiesta di formato. |
| «I Cretesi» → «La loro vita» | Piccola mappa mentale con pochi rami e spiegazioni brevi, senza una lezione piena di date. |
| «I Cretesi» → «Dove vivevano» | Cartina con Creta riconoscibile; non evidenziare tutta la Grecia come se fosse l'isola. |
| «I tipi di angoli» | Chiede quali sta studiando o un esempio; non sceglie una classificazione senza contesto. |
| «Spiegami l'angolo retto» | Risposta diretta con disegno di 90°, spiegazione ed esempio quotidiano. |
| «Non lo so» durante un chiarimento | Una piccola introduzione; niente ripetizione della stessa domanda. |
| «Come funziona il ciclo dell'acqua?» | Poche fasi, frecce coerenti e ritorno alla prima fase, spiegazioni apribili singolarmente. |
| «Raccontami cosa succede prima e dopo» | Sequenza o breve linea del tempo con etichette leggibili anche su telefono. |
| Tocca un elemento → «Più facile», «Fammi un esempio», «Continua» | Riparte dal punto selezionato, senza duplicare automaticamente la visuale. |
| Ricarica una chat con una visuale o un chiarimento | Mantiene materia, disegno e contenuti; soltanto l'ultimo chiarimento completato ha scelte attive. |
| Un luogo manca nel catalogo | Lo dichiara e continua con una spiegazione o uno schema; non inventa cartine. |

Le cartine illustrano la geografia attuale: non rappresentano i confini degli
antichi popoli. Derivano da Natural Earth e sono distribuite con l'app. Le figure
geometriche derivano da parametri verificati dal server, non da immagini generate.
I nuovi argomenti restano nella cronologia; il dizionario continua a raccogliere
le parole di Italiano e Inglese.

I test automatici usano risposte simulate per verificare strumenti, contratti,
streaming, salvataggio e interazione. La qualità delle scelte e delle spiegazioni
va valutata con questi esempi nell'anteprima coach. Le prove automatiche con un
modello reale restano opt-in tramite `LUMI_LIVE_TEST_DATA_DIR`.

## Parole comuni e traduzione immediata

In Inglese una parola isolata richiede una traduzione. Il contesto disponibile
ha precedenza; in sua assenza Lumi sceglie il significato quotidiano più probabile.
Altri significati possibili o marchi non richiedono da soli un chiarimento.

| Domanda o contesto | Cosa verificare |
| --- | --- |
| «apple» | Scheda con mela ed esempio bilingue; nessuna domanda sulla marca. |
| «tuta» | Scheda con tracksuit, precisando tuta da ginnastica; niente immagini. |
| Si parla di astronauti, poi «tuta» | Scheda con spacesuit. |
| «Mostrami una foto di una tuta» | Ricerca immagini consentita dalla richiesta esplicita. |
| Dopo una ricerca immagini, nuova parola «apple» | Torna alla traduzione, senza nuove immagini. |
| Due sensi realmente concorrenti senza una scelta ragionevole | Un solo chiarimento mirato, senza chiedere automaticamente dove è stata letta la parola. |

I primi tre casi sono inclusi in `TestLiveWordClarification`, anche con prompt
personalizzati salvati. Le prove reali restano opt-in; i test simulati non
dimostrano che il modello sceglierà sempre l'azione corretta.

## Posizione di lettura nella chat

Su mobile e desktop le nuove risposte si leggono dall'inizio: per una parola,
prima il significato e poi l'esempio. Il testo in streaming e le schede o immagini
aggiunte successivamente non trascinano la vista al fondo. Scorrere manualmente
interrompe l'ancoraggio; «Ultima risposta» riporta all'inizio dell'ultima risposta
e compare solo quando quel messaggio è interamente fuori vista. Anche riaprendo
una chat si parte dall'inizio dell'ultima risposta.
