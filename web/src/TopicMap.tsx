import { useId, useState } from 'react';
import { ChevronDown, Square, Volume2 } from 'lucide-react';
import type { TopicMap as TopicMapData } from './api/types.gen';

type Props = {
  map?: TopicMapData;
  onSelect?: (point: { branch: string; label: string } | null) => void;
  onRead?: (text: string, node: string) => void;
  readingNode?: string;
};

export function TopicMap({ map, ...props }: Props) {
  if (!map?.branches.length) return null;
  return <TopicMapContent key={JSON.stringify(map)} map={map} {...props}/>;
}

function TopicMapContent({ map, onSelect, onRead, readingNode }: Props & { map: TopicMapData }) {
  const id = useId();
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  const readButton = (text: string, node: string) => onRead && <button type="button" className="listen-button" onClick={() => onRead(text, node)}>
    {readingNode === node ? <><Square size={16}/>Ferma la voce</> : <><Volume2 size={16}/>Ascolta</>}
  </button>;
  return <section className="sentence-map topic-map" aria-label="Mappa dell’argomento">
    <h3>La mappa delle idee</h3>
    <p className="sentence-map-hint">Tocca un ramo, poi scegli cosa scoprire.</p>
    <p className="sentence-map-root">{map.title}</p>
    <ul className="sentence-map-parts topic-map-branches">
      {map.branches.map((branch, branchIndex) => {
        const open = selectedBranch === branchIndex;
        return <li key={branchIndex} className={`sentence-map-part part-color-${branchIndex % 3}`}>
          <button type="button" className="sentence-part-button" aria-expanded={open} aria-controls={`${id}-branch-${branchIndex}`} onClick={() => {
            setSelectedBranch(open ? null : branchIndex); setSelectedItem(null);
            onSelect?.(open ? null : { branch: branch.label, label: branch.label });
          }}>
            <span className="sentence-part-label"><strong>{branch.label}</strong></span>
            <ChevronDown size={18} className={open ? 'expanded' : ''} aria-hidden="true"/>
          </button>
          <div id={`${id}-branch-${branchIndex}`} className="sentence-part-detail" hidden={!open}>
            <p>{branch.explanation}</p>
            {readButton(`${branch.label}. ${branch.explanation}`, `${branchIndex}`)}
            <ul className="topic-map-items">
              {branch.items.map((item, itemIndex) => {
                const expanded = open && selectedItem === itemIndex;
                return <li key={itemIndex}>
                  <button type="button" className="topic-item-button" aria-expanded={expanded} aria-controls={`${id}-${branchIndex}-${itemIndex}`} onClick={() => {
                    setSelectedItem(expanded ? null : itemIndex);
                    onSelect?.({ branch: branch.label, label: expanded ? branch.label : item.label });
                  }}>
                    <strong>{item.label}</strong><ChevronDown size={16} className={expanded ? 'expanded' : ''} aria-hidden="true"/>
                  </button>
                  <div id={`${id}-${branchIndex}-${itemIndex}`} className="topic-item-detail" hidden={!expanded}>
                    <p>{item.explanation}</p>
                    {readButton(`${item.label}. ${item.explanation}`, `${branchIndex}.${itemIndex}`)}
                  </div>
                </li>;
              })}
            </ul>
          </div>
        </li>;
      })}
    </ul>
  </section>;
}
