import { Square, Volume2 } from 'lucide-react';
import type { SpeechInput } from './speech';
import type { WordExplanation as WordExplanationData } from './api/types.gen';

type Props = {
  explanation?: WordExplanationData;
  onRead?: (text: SpeechInput, part: 'meaning' | 'example') => void;
  readingPart?: string;
};

export function WordExplanation({ explanation, onRead, readingPart }: Props) {
  if (!explanation) return null;
  const bilingual = Boolean(explanation.exampleTranslation);
  const language = bilingual ? 'en' : 'it';
  return <section className="word-explanation" aria-label={`La parola ${explanation.word}`}>
    <h3 className="word-heading" lang={language}>{explanation.word}</h3>
    <div className="word-cards">
      {(['meaning', 'example'] as const).map(part => <section key={part} className={`word-card word-card-${part}`} aria-label={part === 'meaning' ? 'Significato' : 'Esempio'}>
        <h4>{part === 'meaning' ? 'Significato' : 'Esempio'}</h4>
        <p lang={part === 'example' ? language : 'it'}>{explanation[part]}</p>{part === 'example' && explanation.exampleTranslation && <p lang="it" className="example-translation">{explanation.exampleTranslation}</p>}
        {onRead && <button type="button" className="listen-button" onClick={() => onRead(bilingual ? part === 'meaning' ? [{ text: explanation.word, language: 'en' }, { text: explanation.meaning, language: 'it' }] : [{ text: explanation.example, language: 'en' }, { text: explanation.exampleTranslation!, language: 'it' }] : part === 'meaning' ? `${explanation.word}. ${explanation.meaning}` : explanation.example, part)}>
          {readingPart === part ? <><Square size={16}/>Ferma la voce</> : <><Volume2 size={16}/>{part === 'meaning' ? 'Ascolta il significato' : 'Ascolta l’esempio'}</>}
        </button>}
      </section>)}
    </div>
  </section>;
}
