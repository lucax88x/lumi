# Dati delle cartine

Le cartine didattiche usano un estratto versionato di **Natural Earth v5.1.2**,
in pubblico dominio: <https://www.naturalearthdata.com/about/terms-of-use/>.
Non servono chiavi, servizi di geocodifica o tile server durante l'uso.

Il catalogo comprende paesi (scala 1:50 milioni), venti regioni italiane ottenute
unendo le province per regione, città principali, fiumi, laghi e isole dei livelli
1:10 milioni. Le geometrie sono semplificate preservando la topologia; non sono
cartine stradali. Le coste, i confini e i corsi d'acqua sono quelli del dataset.
Le forme dei grandi elementi geografici sono generalizzate per uso didattico.

`web/public/geography/ne-v1/` contiene le raccolte GeoJSON caricate su richiesta
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
Una futura revisione deve creare una nuova versione e conservare le risorse delle
precedenti: le conversazioni salvate fanno riferimento a `datasetVersion`.
