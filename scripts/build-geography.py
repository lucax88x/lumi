#!/usr/bin/env python3
"""Build the shipped educational atlas. Optional regeneration only.

Run with Python 3 and shapely==2.1.2 (scripts/requirements-geography.txt).
Downloads pinned Natural Earth v5.1.2 sources into a disposable cache. Outputs
versioned same-origin GeoJSON and the Go lookup catalog. Keep older versions
when publishing a replacement: saved conversations reference their version.
"""
import hashlib
import json
import tempfile
import urllib.request
from collections import defaultdict
from pathlib import Path
from shapely.geometry import shape, mapping
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
VERSION = 'ne-v2'
TAG = 'v5.1.2'
OUT = ROOT / 'web/public/geography' / VERSION
CATALOG = ROOT / 'internal/app/geographydata'
LAYERS = {
    'countries': 'ne_50m_admin_0_countries',
    'regions': 'ne_10m_admin_1_states_provinces',
    'cities': 'ne_10m_populated_places_simple',
    'rivers': 'ne_10m_rivers_lake_centerlines',
    'lakes': 'ne_10m_lakes',
    'islands': 'ne_10m_geography_regions_polys',
}
EXTRA_ALIASES = {
    'Nile': ['Nilo'], 'Blue Nile': ['Nilo Azzurro'], 'White Nile': ['Nilo Bianco'],
    'Tiber': ['Tevere'], 'Danube': ['Danubio'], 'Rhine': ['Reno'], 'Thames': ['Tamigi'],
    'Seine': ['Senna'], 'Amazonas': ['Rio delle Amazzoni'], 'Ganges': ['Gange'],
    'Mississippi': ['Mississippi'], 'Crete': ['Creta'], 'Cairo': ['Il Cairo'],
}

def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')

def clockwise(geom):
    if geom.geom_type == 'Polygon': return orient(geom, sign=-1)
    if geom.geom_type == 'MultiPolygon':
        from shapely.geometry import MultiPolygon
        return MultiPolygon([orient(poly, sign=-1) for poly in geom.geoms])
    return geom

def compact(value):
    if isinstance(value, (list, tuple)): return [compact(x) for x in value]
    if isinstance(value, float): return round(value, 4)
    return value


def build_continents(layers, catalog):
    # Physical regions define continental membership across political borders.
    # Island-group polygons include sea: clip them to real country coastlines.
    land = unary_union([shape(f['geometry']) for f in layers['countries']])
    masks = defaultdict(list)
    for feature in layers['islands']:
        props = {k.lower(): v for k, v in feature['properties'].items()}
        if props.get('featurecla') in ('Continent', 'Island', 'Island group'):
            masks[props.get('region')].append(shape(feature['geometry']))
    regions = {
        'africa': ('Africa', 'Africa', []),
        'antarctica': ('Antarctica', 'Antartide', ['Antarctica', 'Antartico']),
        'asia': ('Asia', 'Asia', []),
        'europe': ('Europe', 'Europa', ['Europe']),
        'north-america': ('North America', 'America del Nord', ['Nord America', 'America settentrionale', 'North America']),
        'south-america': ('South America', 'America del Sud', ['Sud America', 'America meridionale', 'South America']),
        'oceania': ('Oceania', 'Oceania', []),
    }
    geometries = {}
    for key, (region, label, aliases) in regions.items():
        geometries[key] = land.intersection(unary_union(masks[region]))
    geometries['america'] = unary_union([geometries['north-america'], geometries['south-america']])
    regions['america'] = ('America', 'America', ['Americhe', 'Americas'])
    features = []
    for key, (_, label, aliases) in regions.items():
        ident = 'continents-' + key
        geometry = mapping(clockwise(geometries[key].simplify(0.015, preserve_topology=True)))
        geometry['coordinates'] = compact(geometry['coordinates'])
        features.append({'type': 'Feature', 'id': ident, 'properties': {'label': label}, 'geometry': geometry})
        catalog.append({'id': ident, 'label': label, 'kind': 'continents', 'context': 'Continente', 'aliases': sorted(set(aliases + [label]))})
    dump(OUT / 'continents.json', {'type': 'FeatureCollection', 'features': features})
    print('continents', len(features))

def main():
    catalog, sources, layers = [], [], {}
    manifest = OUT / 'sources.json'
    previous = ROOT / 'web/public/geography/ne-v1/sources.json'
    expected = {item['url']: item['sha256'] for item in json.loads((manifest if manifest.exists() else previous).read_text())['sources']}
    for layer, name in LAYERS.items():
        url = f'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{TAG}/geojson/{name}.geojson'
        cache = Path(tempfile.gettempdir()) / 'lumi-natural-earth' / TAG / (name + '.geojson')
        cache.parent.mkdir(parents=True, exist_ok=True)
        if not cache.exists(): urllib.request.urlretrieve(url, cache)
        raw = cache.read_bytes()
        if url in expected and hashlib.sha256(raw).hexdigest() != expected[url]:
            raise ValueError(f'Source checksum changed: {url}')
        sources.append({'url': url, 'sha256': hashlib.sha256(raw).hexdigest()})
        layers[layer] = json.loads(raw)['features']
        grouped = defaultdict(list)
        for feature in layers[layer]:
            p = {k.lower(): v for k, v in feature['properties'].items()}
            name_en = p.get('name_en') or p.get('name') or p.get('admin')
            if layer == 'countries':
                key, label, context = p['adm0_a3'], p.get('name_it') or name_en, 'Paese'
            elif layer == 'regions':
                if p.get('adm0_a3') != 'ITA' or not p.get('region'): continue
                key, label, context = p['region_cod'], p['region'], 'Regione italiana'
            elif layer == 'cities':
                if not name_en or not (p.get('adm0_a3') == 'ITA' or p.get('scalerank', 99) <= 4): continue
                key = str(p.get('ne_id') or p.get('geonameid') or hashlib.sha256((name_en+str(feature['geometry'])).encode()).hexdigest()[:12])
                label, context = p.get('name_it') or name_en, p.get('adm0name') or 'Città'
            elif layer == 'rivers':
                if not name_en: continue
                key, label, context = str(p['rivernum']), name_en, 'Fiume'
                if name_en in EXTRA_ALIASES: label = EXTRA_ALIASES[name_en][0]
            elif layer == 'lakes':
                if not name_en: continue
                key = str(p.get('ne_id') or p.get('wikidataid') or hashlib.sha256(name_en.encode()).hexdigest()[:12])
                label, context = p.get('name_it') or name_en, 'Lago'
            else:
                if p.get('featurecla') not in ('Island', 'Island group'): continue
                key = str(p.get('ne_id') or p.get('wikidataid'))
                label, context = p.get('name_it') or name_en, p.get('subregion') or p.get('region') or 'Isola'
            aliases = {v for k, v in p.items() if k in ('name', 'name_it', 'name_en', 'nameascii', 'namealt', 'name_alt', 'admin') and isinstance(v, str)}
            aliases.update(EXTRA_ALIASES.get(name_en, []))
            if layer == 'regions': aliases = {label}
            grouped[key].append((shape(feature['geometry']), label, context, aliases))
        features = []
        for key, entries in sorted(grouped.items()):
            geom = unary_union([entry[0] for entry in entries]).simplify(0.015, preserve_topology=True)
            if geom.is_empty: continue
            geom = clockwise(geom)
            label, context = entries[0][1:3]
            ident = layer + '-' + key
            aliases = sorted(set().union(*(entry[3] for entry in entries)) | {label})
            catalog.append({'id': ident, 'label': label, 'kind': layer, 'context': context, 'aliases': aliases})
            geo = mapping(geom); geo['coordinates'] = compact(geo['coordinates'])
            features.append({'type': 'Feature', 'id': ident, 'properties': {'label': label}, 'geometry': geo})
        dump(OUT / (layer + '.json'), {'type': 'FeatureCollection', 'features': features})
        print(layer, len(features))
    assert sum(x['kind'] == 'regions' for x in catalog) == 20
    build_continents(layers, catalog)
    dump(CATALOG / 'catalog.json', catalog)
    dump(OUT / 'sources.json', {'version': VERSION, 'source': 'Natural Earth', 'tag': TAG, 'license': 'Public domain', 'sources': sources})

if __name__ == '__main__': main()
