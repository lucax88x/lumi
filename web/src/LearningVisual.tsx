import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Circle, Cloud, CloudRain, House, Mountain, Sprout, Square, Sun, Trees, User, Volume2, Waves } from 'lucide-react';
import { geoBounds, geoCircle, geoMercator, geoNaturalEarth1, geoPath } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { DiagramVisual, GeographyVisual, GeometryFigure, LearningVisual as LearningVisualData } from './api/types.gen';

type Props = {
  visual?: LearningVisualData;
  onSelect?: (label: string | null) => void;
  onRead?: (text: string, node: string) => void;
  readingNode?: string;
};

export function angleName(degrees: number): string {
  if (degrees === 0) return 'nullo';
  if (degrees < 90) return 'acuto';
  if (degrees === 90) return 'retto';
  if (degrees < 180) return 'ottuso';
  if (degrees === 180) return 'piatto';
  if (degrees < 360) return 'concavo';
  return 'giro';
}

export function LearningVisual({ visual, ...props }: Props) {
  if (!visual) return null;
  return <LearningVisualContent key={JSON.stringify(visual)} visual={visual} {...props}/>;
}

function LearningVisualContent({ visual, onSelect, onRead, readingNode }: Props & { visual: LearningVisualData }) {
  const id = useId();
  const [selected, setSelected] = useState(0);
  const explanation = useRef<HTMLDivElement>(null);
  const points = visual.kind === 'geometry' ? visual.figures : visual.kind === 'diagram' ? visual.nodes : visual.features;
  const point = points[selected];
  const choose = (index: number) => {
    setSelected(index);
    onSelect?.(points[index].label);
    window.requestAnimationFrame?.(() => explanation.current?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' }));
  };
  const ordered = visual.kind === 'diagram' && ['sequence', 'timeline'].includes(visual.layout);
  return <section className={`learning-visual learning-${visual.kind}`} aria-label={`Scopriamo: ${visual.title}`}>
    <header className="visual-heading"><h3>{visual.title}</h3><p className="visual-summary">{visual.summary}</p></header>
    {visual.kind !== 'diagram' && points.length > 1 && <div className="visual-switch" role="group" aria-label={visual.kind === 'geometry' ? 'Scegli la figura' : 'Scegli il luogo'}>
      {points.map((item, index) => {
        const label = visual.kind === 'geometry' && visual.figures.every(figure => figure.shape === 'angle') ? item.label.replace(/^angolo\s+/i, '') : item.label;
        return <button key={index} type="button" aria-label={item.label} aria-pressed={selected === index} aria-controls={`${id}-detail`} onClick={() => choose(index)}>{label.charAt(0).toLocaleUpperCase('it') + label.slice(1)}</button>;
      })}
    </div>}
    <div className={`visual-stage visual-stage-${visual.kind}`}>
      {visual.kind === 'geometry' && <GeometryDrawing figure={visual.figures[selected]} onChoose={() => choose(selected)}/>}
      {visual.kind === 'diagram' && <DiagramDrawing visual={visual} selected={selected} onChoose={choose} detailId={`${id}-detail`}/>}
      {visual.kind === 'map' && <GeographyDrawing visual={visual} selected={selected} onChoose={choose}/>}
    </div>
    {point && <div ref={explanation} className="visual-explanation" id={`${id}-detail`} aria-live="polite" aria-atomic="true">
      <div className="visual-detail-heading"><h4>{ordered && <span className="visual-step">{selected + 1}</span>}{point.label}</h4>
        {onRead && <button type="button" className="listen-button visual-read" onClick={() => onRead(`${point.label}. ${point.explanation}`, `${selected}`)}>
          {readingNode === `${selected}` ? <><Square size={16}/>Ferma la voce</> : <><Volume2 size={17}/>Ascolta</>}
        </button>}
      </div>
      <p>{point.explanation}</p>
    </div>}
    {visual.kind === 'map' && <p className="map-credit">Geografia di oggi. Dati Natural Earth.</p>}
  </section>;
}

export function GeometryDrawing({ figure, onChoose }: { figure: GeometryFigure; onChoose?: () => void }) {
  const marker = useId();
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 3.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const degrees = figure.degrees ?? 90;
  const theta = degrees * Math.PI / 180;
  const end = [80 + 85 * Math.cos(theta), 95 - 85 * Math.sin(theta)];
  const arcEnd = [80 + 30 * Math.cos(theta), 95 - 30 * Math.sin(theta)];
  const width = figure.width ?? ((figure.shape === 'square' || figure.shape === 'circle') ? figure.height : undefined) ?? (figure.shape === 'rectangle' ? 150 : 110);
  const height = figure.height ?? (figure.shape === 'triangle' ? width * Math.sqrt(3) / 2 : figure.shape === 'rectangle' ? 90 : width);
  const factor = Math.min(160 / width, 115 / height);
  const w = width * factor; const h = height * factor;
  return <svg onClick={onChoose} className={`geometry-drawing ${onChoose ? 'visual-tap-target' : ''}`} viewBox="-15 -5 240 190" role="img" aria-label={figure.shape === 'angle' ? `${figure.label}: ${degrees} gradi, angolo ${angleName(degrees)}` : figure.label}>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10" fill="none" stroke="currentColor" strokeWidth="1.5"/></marker></defs>
    {figure.shape === 'angle' ? <>
      <path {...stroke} d={`M165,95 L80,95 L${end[0]},${end[1]}`}/>
      {degrees === 90 ? <path {...stroke} strokeWidth={2} d="M100,95 L100,75 L80,75"/> : degrees === 360 ? <circle {...stroke} strokeWidth={2} cx="80" cy="95" r="30"/> : degrees > 0 ? <path {...stroke} strokeWidth={2} d={`M110,95 A30,30 0 ${degrees > 180 ? 1 : 0} 0 ${arcEnd[0]},${arcEnd[1]}`}/> : null}
      <circle cx="80" cy="95" r="4" fill="currentColor"/>
      <text x="105" y="174" textAnchor="middle" className="geometry-caption">{degrees}°</text>
    </> : figure.shape === 'circle' ? <circle {...stroke} cx="105" cy="85" r="58"/> : figure.shape === 'triangle' ? <path {...stroke} d={`M${105 - w / 2},${85 + h / 2} L${105 + w / 2},${85 + h / 2} L105,${85 - h / 2} Z`}/> : figure.shape === 'square' || figure.shape === 'rectangle' ? <rect {...stroke} x={105 - w / 2} y={85 - h / 2} width={w} height={h}/> : <>
      <path {...stroke} d="M25,85 L185,85" markerEnd={figure.shape !== 'segment' ? `url(#${marker})` : undefined} markerStart={figure.shape === 'line' ? `url(#${marker})` : undefined}/>
      {figure.shape !== 'line' && <circle cx="25" cy="85" r="4" fill="currentColor"/>}
      {figure.shape === 'segment' && <circle cx="185" cy="85" r="4" fill="currentColor"/>}
    </>}
  </svg>;
}

const symbols = { sun: Sun, cloud: Cloud, rain: CloudRain, mountain: Mountain, river: Waves, sea: Waves, tree: Trees, plant: Sprout, person: User, house: House, arrow: ArrowRight, dot: Circle };
type NodeBox = { x: number; y: number; width: number; height: number };
type DiagramSize = { width: number; height: number; boxes: NodeBox[] };

function diagramCell(count: number, index: number, cycle: boolean) {
  if (!cycle || count === 2) return {};
  const cells: Record<number, [number, number][]> = {
    3: [[1, 1], [2, 2], [2, 1]],
    4: [[1, 1], [1, 2], [2, 2], [2, 1]],
    5: [[1, 1], [2, 2], [3, 2], [3, 1], [2, 1]],
    6: [[1, 1], [1, 2], [2, 2], [3, 2], [3, 1], [2, 1]],
  };
  const [row, column] = cells[count][index];
  return { gridRow: row, gridColumn: index === 0 && count % 2 ? '1 / -1' : column };
}

function diagramEdge(from: NodeBox, to: NodeBox, curved: boolean) {
  const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const b = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const dx = b.x - a.x; const dy = b.y - a.y;
  const source = Math.min(from.width / (2 * Math.abs(dx)), from.height / (2 * Math.abs(dy)));
  const target = Math.min(to.width / (2 * Math.abs(dx)), to.height / (2 * Math.abs(dy)));
  const length = Math.hypot(dx, dy) || 1;
  const x1 = a.x + dx * source + dx / length * 3; const y1 = a.y + dy * source + dy / length * 3;
  const x2 = b.x - dx * target - dx / length * 5; const y2 = b.y - dy * target - dy / length * 5;
  return curved ? `M${x1},${y1} Q${(x1 + x2) / 2},${(y1 + y2) / 2 + (dx > 0 ? -18 : 18)} ${x2},${y2}` : `M${x1},${y1} L${x2},${y2}`;
}

function DiagramDrawing({ visual, selected, onChoose, detailId }: { visual: DiagramVisual; selected: number; onChoose: (index: number) => void; detailId: string }) {
  const marker = useId();
  const board = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [size, setSize] = useState<DiagramSize>();
  const cycle = visual.layout === 'cycle';
  const ordered = visual.layout === 'sequence' || visual.layout === 'timeline';
  useLayoutEffect(() => {
    let alive = true;
    const measure = () => {
      const element = board.current;
      if (!alive || !element) return;
      const rect = element.getBoundingClientRect();
      const boxes = buttons.current.map(button => {
        const bounds = button!.getBoundingClientRect();
        return { x: bounds.left - rect.left, y: bounds.top - rect.top, width: bounds.width, height: bounds.height };
      });
      setSize({ width: rect.width, height: rect.height, boxes });
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined;
    if (board.current) observer?.observe(board.current);
    void document.fonts?.ready.then(measure);
    return () => { alive = false; observer?.disconnect(); };
  }, [visual]);
  return <div ref={board} className={`diagram-drawing diagram-board diagram-${visual.layout} ${cycle && visual.nodes.length % 2 ? 'diagram-odd-cycle' : ''}`} role="group" aria-label={`Schema: ${visual.title}`}>
    {size && size.width > 0 && <svg className="diagram-connections" width={size.width} height={size.height} aria-hidden="true">
      <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1,1 L9,5 L1,9" fill="none" stroke="var(--study-accent)" strokeWidth="1.7"/></marker></defs>
      {visual.edges.map((edge, index) => {
        const from = visual.nodes.findIndex(node => node.id === edge.from); const to = visual.nodes.findIndex(node => node.id === edge.to);
        if (!size.boxes[from] || !size.boxes[to]) return null;
        return <path key={index} d={diagramEdge(size.boxes[from], size.boxes[to], cycle && visual.nodes.length === 2)} className={from === selected ? 'diagram-connection-active' : ''} fill="none" strokeWidth="2" markerEnd={`url(#${marker})`}/>;
      })}
    </svg>}
    {visual.nodes.map((node, index) => {
      const Icon = symbols[node.symbol ?? 'dot'];
      return <button key={node.id} ref={element => { buttons.current[index] = element; }} type="button" className="diagram-node" style={diagramCell(visual.nodes.length, index, cycle)} aria-pressed={selected === index} aria-controls={detailId} onClick={() => onChoose(index)}>
        {ordered ? <span className="diagram-step" aria-hidden="true">{index + 1}</span> : <Icon size={25} strokeWidth={1.7} aria-hidden="true"/>}
        <span className="diagram-node-label">{node.label}{node.timeLabel && <small>{node.timeLabel}</small>}</span>
      </button>;
    })}
  </div>;
}

const continentLabels: Record<string, [number, number]> = {
  'continents-africa': [20, 3], 'continents-america': [-105, 24],
  'continents-north-america': [-105, 40], 'continents-south-america': [-61, -14],
  'continents-antarctica': [0, -79], 'continents-asia': [100, 45],
  'continents-europe': [12, 57], 'continents-oceania': [140, -31],
};
const oceanLabels: { label: string; at: [number, number] }[] = [
  { label: 'Pacifico', at: [-130, -24] }, { label: 'Atlantico', at: [-34, 25] },
  { label: 'Indiano', at: [77, -32] },
];
const groups = ['continents', 'countries', 'regions', 'cities', 'rivers', 'lakes', 'islands'];
const atlasCache = new Map<string, Promise<FeatureCollection>>();
async function atlasGroup(version: string, group: string) {
  if (!['ne-v1', 'ne-v2'].includes(version) || !groups.includes(group) || (version === 'ne-v1' && group === 'continents')) throw new Error('Cartina non disponibile.');
  const key = `${version}/${group}`;
  if (!atlasCache.has(key)) atlasCache.set(key, fetch(`/geography/${key}.json`).then(async response => {
    if (!response.ok) throw new Error('Cartina non disponibile.');
    const data = await response.json() as FeatureCollection;
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Cartina non disponibile.');
    return data;
  }).catch(error => { atlasCache.delete(key); throw error; }));
  return atlasCache.get(key)!;
}
function GeographyDrawing({ visual, selected, onChoose }: { visual: GeographyVisual; selected: number; onChoose: (index: number) => void }) {
  const [data, setData] = useState<{ background: FeatureCollection; highlights: Feature[] }>();
  const [failed, setFailed] = useState(false); const [attempt, setAttempt] = useState(0);
  const featureIds = visual.features.map(feature => feature.id).join(',');
  useEffect(() => {
    let alive = true; setFailed(false); setData(undefined);
    const needed = [...new Set([visual.view === 'world' ? 'continents' : 'countries', ...visual.features.map(f => f.id.split('-')[0])])];
    void Promise.all(needed.map(group => atlasGroup(visual.datasetVersion, group))).then(collections => {
      const features = collections.flatMap(collection => collection.features);
      const highlights = visual.features.map(point => features.find(f => f.id === point.id));
      if (highlights.some(f => !f)) throw new Error('Luogo non disponibile.');
      if (alive) setData({ background: collections[0], highlights: highlights as Feature[] });
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [visual.datasetVersion, visual.view, featureIds, attempt]);
  if (failed) return <p className="notice" role="status">Non riesco a caricare la cartina. Le spiegazioni sono qui sotto. <button type="button" className="text-button" onClick={() => setAttempt(n => n + 1)}>Riprova</button></p>;
  if (!data) return <p role="status">Preparo la cartina…</p>;
  const focus: FeatureCollection = { type: 'FeatureCollection', features: data.highlights.map(feature => {
    if (feature.geometry.type !== 'Point') return feature;
    return { type: 'Feature', properties: {}, geometry: geoCircle().center(feature.geometry.coordinates as [number, number]).radius(2)() };
  }) };
  const bounds = geoBounds(focus);
  const centerLon = bounds[1][0] < bounds[0][0] ? (bounds[0][0] + bounds[1][0] + 360) / 2 : (bounds[0][0] + bounds[1][0]) / 2;
  const world = visual.view === 'world';
  const projection = world
    ? geoNaturalEarth1().rotate([0, 0]).fitExtent([[10, 30], [350, 230]], { type: 'Sphere' })
    : (bounds[1][1] - bounds[0][1] > 120 ? geoNaturalEarth1() : geoMercator()).rotate([-centerLon, 0]).fitExtent([[22, 24], [298, 216]], focus);
  const path = geoPath(projection).pointRadius(6);
  return <>
    <svg className={`geography-drawing ${world ? 'world-drawing' : ''}`} viewBox={world ? '0 0 360 250' : '0 0 320 240'} role={world ? 'group' : 'img'} aria-label={`Cartina: ${visual.title}`}>
      <title>{visual.title}</title><desc>{visual.summary}. Tocca un luogo evidenziato per scoprirlo.</desc>
      <rect width={world ? 360 : 320} height={world ? 250 : 240} fill="#EDF5F8"/>
      <g className="map-background" fill="#fbfaf1" stroke="#b5bbad" strokeWidth={world ? 0.4 : 0.7}>{data.background.features.filter(feature => !world || !['continents-north-america', 'continents-south-america'].includes(String(feature.id))).map((feature, index) => <path key={index} d={path(feature) ?? ''}/>)}</g>
      {!world && data.background.features.map(feature => ({ feature, center: path.centroid(feature), area: path.area(feature) }))
        .filter(({ feature, center, area }) => !data.highlights.some(highlight => highlight.id === feature.id) && area > 1000 && center.every(Number.isFinite) && center[0] > 38 && center[0] < 295 && center[1] > 35 && center[1] < 215)
        .sort((a, b) => b.area - a.area).slice(0, 3)
        .map(({ feature, center }) => <text key={String(feature.id)} x={center[0]} y={center[1]} textAnchor="middle" className="map-country-label">{feature.properties?.label}</text>)}
      {data.highlights.map((feature, index) => {
        const line = feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString';
        const anchor = world ? continentLabels[String(feature.id)] : undefined;
        const centroid = anchor ? projection(anchor) ?? [NaN, NaN] : path.centroid(feature as Feature<Geometry>);
        const visible = centroid.every(Number.isFinite) && centroid[0] >= 15 && centroid[0] <= 305 && centroid[1] >= 15 && centroid[1] <= 225;
        return <g key={index} className="map-feature visual-tap-target" role={world ? 'button' : undefined} tabIndex={world ? 0 : undefined} aria-label={world ? `Seleziona ${visual.features[index].label}` : undefined} aria-pressed={world ? selected === index : undefined} onClick={() => onChoose(index)} onKeyDown={event => {
          if (world && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onChoose(index); }
        }}>
          {line && <path d={path(feature) ?? ''} fill="none" stroke="transparent" strokeWidth="18"/>}
          <path d={path(feature) ?? ''} fill={line ? 'none' : selected === index ? '#A8D2DE' : '#E4EDF0'} stroke="#287CAA" strokeWidth={selected === index ? (line ? 3 : 1.8) : 1.2}/>
          {world && anchor && <text x={centroid[0]} y={centroid[1]} textAnchor="middle" className="map-continent-label">
            {String(feature.properties?.label ?? visual.features[index].label).split(' del ').map((part, lineIndex) => <tspan key={lineIndex} x={centroid[0]} dy={lineIndex ? 16 : 0}>{lineIndex ? `del ${part}` : part}</tspan>)}
          </text>}
          {!world && visible && <g className="map-pin" transform={`translate(${centroid[0]},${centroid[1]})`}>
            <circle r={selected === index ? 11 : 8} fill={selected === index ? '#287CAA' : '#FFFFFF'} stroke={selected === index ? '#FFFFFF' : '#287CAA'} strokeWidth="2.5"/>
            <circle r="3" fill={selected === index ? '#FFFFFF' : '#287CAA'} pointerEvents="none"/>
          </g>}
        </g>;
      })}
      {world && oceanLabels.map(({ label, at }) => {
        const [x, y] = projection(at)!;
        return <text key={label} x={x} y={y} textAnchor="middle" className="map-ocean-label"><tspan x={x}>Oceano</tspan><tspan x={x} dy="12">{label}</tspan></text>;
      })}
      <text x={world ? 342 : 302} y="18" textAnchor="middle" fontSize="13" fill="#3f5661">N ↑</text>
    </svg>
  </>;
}
