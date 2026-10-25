import { Square, Volume2 } from 'lucide-react';
import type { WordExplanation as WordExplanationData } from './api/types.gen';

type Props = {
  explanation?: WordExplanationData;
  onRead?: (text: string, part: 'meaning' | 'example') => void;
  readingPart?: string;
};

export function WordExplanation({ explanation, onRead, readingPart }: Props) {
  if (!explanation) return null;
  return <section className="word-explanation" aria-label={`La parola ${explanation.word}`}>
    <h3 className="word-heading">{explanation.word}</h3>
    <div className="word-cards">
      {(['meaning', 'example'] as const).map(part => <section key={part} className={`word-card word-card-${part}`} aria-label={part === 'meaning' ? 'Significato' : 'Esempio'}>
        <h4>{part === 'meaning' ? 'Significato' : 'Esempio'}</h4>
        <p>{explanation[part]}</p>
        {onRead && <button type="button" className="listen-button" onClick={() => onRead(part === 'meaning' ? `${explanation.word}. ${explanation.meaning}` : explanation.example, part)}>
          {readingPart === part ? <><Square size={16}/>Ferma la voce</> : <><Volume2 size={16}/>{part === 'meaning' ? 'Ascolta il significato' : 'Ascolta l’esempio'}</>}
        </button>}
      </section>)}
    </div>
  </section>;
}
