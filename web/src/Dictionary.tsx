import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, BookOpen, Check, Flower2, RotateCcw, Square, Volume2 } from 'lucide-react';
import { getStatusOptions, listDictionaryWordsOptions } from './api/@tanstack/react-query.gen';
import type { DictionaryEntry } from './api/types.gen';
import { familyID } from './portal-state';
import { errorMessage, shortDate } from './lib';
import { useSpeech } from './speech';
import { WordExplanation } from './WordExplanation';
import { LoadingSkeleton } from './LoadingSkeleton';

export function DictionaryPage() {
  const familyId = familyID();
  const words = useQuery(listDictionaryWordsOptions({ path: { familyId } }));
  const status = useQuery(getStatusOptions({ path: { familyId } }));
  return <div className="child-page dictionary-page">
    <Link to="/famiglie/$familyId" params={{ familyId }} className="back-link"><ArrowLeft size={16}/>Il mio angolino</Link>
    <div className="dictionary-heading"><BookOpen size={30} aria-hidden="true"/><div><h1>Il mio dizionario</h1><p>Le parole che hai scoperto, da ritrovare e ripassare.</p></div></div>
    {words.isPending && <LoadingSkeleton variant="dictionary" label="Caricamento del dizionario" rows={4}/>}
    {words.isError && <p className="notice error-notice" role="alert">{errorMessage(words.error)} <button className="text-button" onClick={() => void words.refetch()}>Riprova</button></p>}
    {words.data && <Dictionary words={words.data} speechRate={status.data?.speechRate}/>}
  </div>;
}

export function Dictionary({ words, speechRate }: { words: DictionaryEntry[]; speechRate?: number }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [practice, setPractice] = useState<DictionaryEntry[] | null>(null);
  const speech = useSpeech(speechRate);
  const matching = words.filter(word => word.word.toLocaleLowerCase('it').normalize('NFC').includes(search.trim().toLocaleLowerCase('it').normalize('NFC')));
  const entry = matching.find(word => word.id === selected);
  const read = (text: string, part: string) => speech.activeMessageId === part ? speech.stop() : speech.speak(text, part);
  if (practice) return <Flashcards words={practice} speechRate={speechRate} onClose={() => setPractice(null)}/>;
  if (words.length === 0) return <div className="empty-state"><BookOpen size={32}/><p>Le parole che chiedi a Lumi compariranno qui.</p><p>Una scoperta alla volta.</p></div>;
  return <>
    <div className="dictionary-toolbar">
      <div className="dictionary-search"><label htmlFor="dictionary-search">Cerca una parola</label><input id="dictionary-search" type="search" value={search} onChange={e => { speech.stop(); setSearch(e.target.value); }}/></div>
      <button className="primary-button" disabled={matching.length === 0} onClick={() => { speech.stop(); setPractice([...matching]); }}><Flower2 size={18}/>Ripassiamo</button>
    </div>
    <p className="dictionary-count" role="status">{matching.length === 1 ? '1 parola da riscoprire' : `${matching.length} parole da riscoprire`}</p>
    {matching.length === 0 && <p>Nessuna parola trovata. Prova a cercarne un’altra.</p>}
    <ul className="dictionary-list">{matching.map(word => <li key={word.id}>
      <button type="button" aria-expanded={entry?.id === word.id} aria-controls={`word-${word.id}`} onClick={() => { speech.stop(); setSelected(selected === word.id ? null : word.id); }}>
        <strong>{word.word}</strong>{' '}<span>Scoperta il {shortDate(word.lastAskedAt)}</span>
      </button>
      {entry?.id === word.id && <div id={`word-${word.id}`} className="dictionary-detail"><WordExplanation explanation={entry} onRead={read} readingPart={speech.activeMessageId ?? undefined}/></div>}
    </li>)}</ul>
    {speech.blocked && <p className="notice">Per ascoltare serve una voce italiana sul dispositivo.</p>}
  </>;
}

function Flashcards({ words, speechRate, onClose }: { words: DictionaryEntry[]; speechRate?: number; onClose: () => void }) {
  const [deck, setDeck] = useState(words);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [again, setAgain] = useState<DictionaryEntry[]>([]);
  const speech = useSpeech(speechRate);
  const current = deck[index];
  function advance(remembered: boolean) {
    speech.stop();
    if (!remembered) setAgain(previous => [...previous, current]);
    setIndex(previous => previous + 1); setRevealed(false);
  }
  const read = (text: string, part: string) => speech.activeMessageId === part ? speech.stop() : speech.speak(text, part);
  return <section className="practice" aria-label="Ripassiamo le parole">
    <button className="text-button" onClick={() => { speech.stop(); onClose(); }}><ArrowLeft size={16}/>Torna al dizionario</button>
    {current ? <>
      <p className="practice-progress" role="status">Parola {index + 1} di {deck.length}</p>
      <div className="practice-question"><h2>{current.word}</h2><p>Ti ricordi che cosa significa?</p>
        <button className="listen-button" onClick={() => read(current.word, 'word')}>{speech.activeMessageId === 'word' ? <><Square size={16}/>Ferma la voce</> : <><Volume2 size={16}/>Ascolta la parola</>}</button>
      </div>
      {!revealed ? <button className="primary-button" onClick={() => { speech.stop(); setRevealed(true); }}>Mostra il significato</button> : <>
        <WordExplanation explanation={current} onRead={read} readingPart={speech.activeMessageId ?? undefined}/>
        <div className="practice-actions"><button className="soft-button" onClick={() => advance(false)}><RotateCcw size={18}/>Da ripassare</button><button className="primary-button" onClick={() => advance(true)}><Check size={18}/>La ricordo</button></div>
      </>}
    </> : <div className="practice-complete" role="status"><Flower2 size={36}/><h2>Un bel momento di ripasso!</h2><p>Puoi fermarti qui o riscoprire ancora le parole.</p>
      {again.length > 0 && <button className="primary-button" onClick={() => { setDeck(again); setAgain([]); setIndex(0); setRevealed(false); }}><RotateCcw size={18}/>Ripassa ancora ({again.length})</button>}
      <button className="soft-button" onClick={onClose}>Finito per oggi</button>
    </div>}
    {speech.blocked && <p className="notice">Per ascoltare serve una voce italiana sul dispositivo.</p>}
  </section>;
}
