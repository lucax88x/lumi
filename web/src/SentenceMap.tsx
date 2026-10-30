import { useId, useState } from 'react';
import { ChevronDown, Square, Volume2 } from 'lucide-react';
import type { SpeechInput } from './speech';
import type { SentenceMap as SentenceMapData } from './api/types.gen';

type Props = {
  map?: SentenceMapData;
  onRead?: (text: SpeechInput, index: number) => void;
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
    <p className="sentence-map-root" lang={map.language ?? 'it'}>{map.sentence}</p>{map.translation && <p className="sentence-translation" lang={map.language === 'en' ? 'it' : 'en'}>{map.translation}</p>}
    {map.language && onRead && <button type="button" className="listen-button" onClick={() => onRead([{ text: map.sentence, language: map.language! }, ...(map.translation ? [{ text: map.translation, language: map.language === 'en' ? 'it' as const : 'en' as const }] : [])], -1)}>{readingPart === -1 ? <><Square size={16}/>Ferma la voce</> : <><Volume2 size={16}/>Ascolta la frase</>}</button>}
    <ol className="sentence-map-parts" data-compact={map.parts.length <= 3}>
      {map.parts.map((part, index) => {
        const open = selected === index;
        return <li key={index} className={`sentence-map-part part-color-${index % 3}`}>
          <button type="button" className="sentence-part-button" aria-expanded={open} aria-controls={`${id}-${index}`} onClick={() => { onSelect?.(open ? null : index); setSelected(open ? null : index); }}>
            <span className="sentence-part-number" aria-hidden="true">{index + 1}</span>
            <span className="sentence-part-label"><span>{part.question}</span><strong lang={map.language ?? 'it'}>{part.text}</strong></span>
            <ChevronDown size={18} className={open ? 'expanded' : ''} aria-hidden="true"/>
          </button>
          <div id={`${id}-${index}`} className="sentence-part-detail" hidden={!open}>
            <p>{part.explanation}</p>{part.translation && <p lang={map.language === 'en' ? 'it' : 'en'}>{part.translation}</p>}
            {onRead && <button type="button" className="listen-button" onClick={() => onRead(map.language ? [{ text: part.text, language: map.language }, ...(part.translation ? [{ text: part.translation, language: map.language === 'en' ? 'it' as const : 'en' as const }] : []), { text: part.explanation, language: 'it' }] : `${part.text} ${part.explanation}`, index)}>{readingPart === index ? <><Square size={16}/>Ferma la voce</> : <><Volume2 size={16}/>Ascolta il pezzetto</>}</button>}
          </div>
        </li>;
      })}
    </ol>
  </section>;
}
