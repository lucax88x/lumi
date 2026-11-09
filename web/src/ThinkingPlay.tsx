import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { Message } from './api/types.gen';
import { Avatar } from './Avatar';
import { narrativeText } from './lib';

const scenes = [
  { name: 'star', caption: 'Ehi, stellina! Aspettami!' },
  { name: 'tumble', caption: 'Un’idea a testa in giù!' },
  { name: 'bubbles', caption: 'Una bolla… due bolle… pop!' },
] as const;

export function isWaitingForAnswer(message: Message) {
  return message.role === 'assistant' && message.status === 'streaming'
    && !narrativeText(message.text).trim() && !message.images?.length
    && !message.sentenceMap && !message.topicMap && !message.wordExplanation
    && !message.wordClarification && !message.studyClarification && !message.learningVisual;
}

export function ThinkingPlay({ message }: { message: Message }) {
  return isWaitingForAnswer(message) ? <WaitingScene key={message.id}/> : null;
}

function WaitingScene() {
  const [sceneIndex, setSceneIndex] = useState(0);
  const scene = scenes[sceneIndex];

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setInterval> | undefined;
    function updateMotion() {
      clearInterval(timer);
      if (!preference.matches) timer = setInterval(() => setSceneIndex(index => (index + 1) % scenes.length), 8000);
    }
    updateMotion();
    preference.addEventListener('change', updateMotion);
    return () => { clearInterval(timer); preference.removeEventListener('change', updateMotion); };
  }, []);

  return <div className="thinking-play">
    <span className="sr-only" role="status">Lumi sta pensando. La risposta sta arrivando.</span>
    <div className={`thinking-stage thinking-${scene.name}`} aria-hidden="true">
      <span className="thinking-floor"/>
      <div className="thinking-friend"><Avatar/></div>
      {scene.name === 'star' && <svg className="thinking-little-star" viewBox="0 0 64 64" fill="none"><path d="m32 6 7 17 18 2-14 12 4 19-15-10-15 10 4-19L7 25l18-2Z" fill="#f8e5a0" stroke="#d3b35c" strokeWidth="2" strokeLinejoin="round"/><circle cx="28" cy="30" r="2" fill="#795d4a"/><circle cx="39" cy="30" r="2" fill="#795d4a"/><path d="M29 37q5 5 9-1" stroke="#795d4a" strokeWidth="2" strokeLinecap="round"/></svg>}
      {scene.name === 'tumble' && <><span className="thinking-whoosh thinking-whoosh-one"/><span className="thinking-whoosh thinking-whoosh-two"/></>}
      {scene.name === 'bubbles' && <><span className="thinking-bubble thinking-bubble-one"/><span className="thinking-bubble thinking-bubble-two"/><span className="thinking-bubble thinking-bubble-three"/></>}
    </div>
    <div className="thinking-copy">
      <p className="thinking-caption">{scene.caption}</p>
      <span className="thinking-note">Intanto preparo la tua risposta…</span>
      <button className="thinking-next" type="button" onClick={() => setSceneIndex(index => (index + 1) % scenes.length)}><RefreshCw size={14}/>Un’altra magia</button>
    </div>
  </div>;
}
