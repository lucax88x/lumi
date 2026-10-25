import { useId, useState } from 'react';
import { ChevronDown, Square, Volume2 } from 'lucide-react';
import type { SentenceMap as SentenceMapData } from './api/types.gen';

type Props = {
  map?: SentenceMapData;
  onRead?: (text: string, index: number) => void;
  onSelect?: (index: number | null) => void;
  readingPart?: number;
};

export function SentenceMap({ map, ...props }: Props) {
  if (!map?.parts.length) return null;
  return <MapContent key={JSON.stringify(map)} map={map} {...props}/>;
}

function MapContent({ map, onRead, onSelect, readingPart }: Props & { map: SentenceMapData }) {
  const id = useId();
  const [selected, setSelected] = useState<number | null>(0);
  return <section className="sentence-map" aria-label="Mappa della frase">
    <h3>La frase, a pezzetti</h3>
    <p className="sentence-map-hint">Tocca un pezzetto per capirlo.</p>
    <p className="sentence-map-root">{map.sentence}</p>
    <ol className="sentence-map-parts" data-compact={map.parts.length <= 3}>
      {map.parts.map((part, index) => {
        const open = selected === index;
        return <li key={index} className={`sentence-map-part part-color-${index % 3}`}>
          <button type="button" className="sentence-part-button" aria-expanded={open} aria-controls={`${id}-${index}`} onClick={() => { onSelect?.(open ? null : index); setSelected(open ? null : index); }}>
            <span className="sentence-part-number" aria-hidden="true">{index + 1}</span>
            <span className="sentence-part-label"><span>{part.question}</span><strong>{part.text}</strong></span>
            <ChevronDown size={18} className={open ? 'expanded' : ''} aria-hidden="true"/>
          </button>
          <div id={`${id}-${index}`} className="sentence-part-detail" hidden={!open}>
            <p>{part.explanation}</p>
            {onRead && <button type="button" className="listen-button" onClick={() => onRead(`${part.text} ${part.explanation}`, index)}>{readingPart === index ? <><Square size={16}/>Ferma la voce</> : <><Volume2 size={16}/>Ascolta il pezzetto</>}</button>}
          </div>
        </li>;
      })}
    </ol>
  </section>;
}
