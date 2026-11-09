# Dati delle cartine

Le cartine didattiche usano un estratto versionato di **Natural Earth v5.1.2**,
in pubblico dominio: <https://www.naturalearthdata.com/about/terms-of-use/>.
Non servono chiavi, servizi di geocodifica o tile server durante l'uso.

Il catalogo `ne-v2` comprende sei continenti (con America unita), le due Americhe
separate per le richieste di sette continenti, paesi (scala 1:50 milioni), venti regioni italiane ottenute
unendo le province per regione, città principali, fiumi, laghi e isole dei livelli
1:10 milioni. Le geometrie sono semplificate preservando la topologia; non sono
cartine stradali. Le coste, i confini e i corsi d'acqua sono quelli del dataset.
Le forme dei grandi elementi geografici sono generalizzate per uso didattico.

`web/public/geography/ne-v2/` contiene le raccolte GeoJSON caricate su richiesta
ed è incluso nella normale build frontend. `sources.json` documenta URL originali
e checksum SHA-256. Il corrispondente catalogo di nomi e alias è incorporato nel
server da `internal/app/geographydata/catalog.json`. Gli id passati al tool devono
essere stati restituiti da una ricerca nello stesso turno; l'agente non genera
coordinate o percorsi SVG. In caso di omonimia sceglie dopo un chiarimento.

Per rigenerare i dati, in un ambiente Python separato:

```sh
python3 -m venv /tmp/lumi-geography
/tmp/lumi-geography/bin/pip install -r scripts/requirements-geography.txt
/tmp/lumi-geography/bin/python scripts/build-geography.py
```

La rigenerazione non fa parte della build normale: i file generati sono inclusi
nel repository. Controllare il diff delle geometrie, il catalogo e i checksum.
`ne-v1` resta disponibile integralmente per le conversazioni già salvate. Le nuove
cartine usano `ne-v2`. `view: world` usa la proiezione Natural Earth su tutta la
sfera, Antartide inclusa, senza confini politici interni; senza `view` si mantiene
l'inquadratura `focus` dei luoghi evidenziati. Le etichette hanno ancoraggi fissi:
selezionare un continente non cambia la proiezione.

I continenti derivano dalle regioni fisiche del livello
`ne_10m_geography_regions_polys` e dalle coste dei paesi già presenti nel dataset.
I poligoni delle isole e degli arcipelaghi sono raggruppati per regione fisica;
sono intersecati con le terre emerse, perché le aree degli arcipelaghi includono
anche mare. Questo conserva Australia, Nuova Zelanda, Nuova Guinea, Tasmania e
le isole oceaniche disponibili senza colorare intere zone di oceano come terra.
L'America è l'unione geometrica di Nord e Sud. Le geometrie sono generalizzate,
non rappresentano una classificazione universale dei continenti.

`continenti`, `mondo` e `planisfero` restituiscono i sei continenti in una ricerca;
`sette continenti` ne restituisce sette. Per la verifica del formato scelto dal
modello esiste una prova opt-in, che consuma il piano configurato:

```sh
LUMI_LIVE_TEST_DATA_DIR=/percorso/dati mise exec -- go test ./internal/app -run TestLiveContinentFormat -v
```

Una futura revisione deve creare una nuova versione e conservare le risorse delle
precedenti: le conversazioni salvate fanno riferimento a `datasetVersion`.
