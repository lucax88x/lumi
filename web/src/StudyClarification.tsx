import { useState } from 'react';
import { CircleHelp } from 'lucide-react';
import type { StudyClarification as StudyClarificationData } from './api/types.gen';

type Props = { clarification?: StudyClarificationData; onChoose?: (reply: string) => void; disabled?: boolean };

export function StudyClarification({ clarification, onChoose, disabled = false }: Props) {
  const [chosen, setChosen] = useState<string>();
  if (!clarification) return null;
  const choose = (reply: string) => { setChosen(reply); onChoose?.(reply); };
  return <section className="study-clarification" data-active={Boolean(onChoose)} aria-label={`Scopriamo ${clarification.topic}`}>
    <p className="clarification-question">{clarification.question}</p>
    <div className="study-choices">
      {clarification.choices.map((choice, index) => onChoose
        ? <button type="button" className="study-choice-button" disabled={disabled} aria-pressed={chosen === choice.reply} key={index} onClick={() => choose(choice.reply)}><span className="study-choice-dot" aria-hidden="true"/>{choice.label}</button>
        : <span className="study-choice" key={index}>{choice.label}</span>)}
    </div>
    {onChoose && <>
      <button type="button" className="study-unsure" disabled={disabled} onClick={() => choose('Non lo so. Aiutami con una prima scoperta semplice, senza chiedermi ancora quale parte scegliere.')}><CircleHelp size={19} aria-hidden="true"/>Non lo so</button>
      <p className="clarification-hint">Puoi anche scrivere o dire un esempio.</p>
    </>}
  </section>;
}
