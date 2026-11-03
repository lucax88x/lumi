import type { WordClarification as WordClarificationData } from './api/types.gen';

type Props = {
  clarification?: WordClarificationData;
  onChoose?: (sentence: string) => void;
  disabled?: boolean;
};

export function WordClarification({ clarification, onChoose, disabled = false }: Props) {
  if (!clarification) return null;
  return <section className="word-clarification" aria-label={`Il contesto di ${clarification.word}`}>
    <p className="clarification-question">{clarification.question}</p>
    {clarification.examples.length > 0 && <>
      <div className="clarification-examples">
        {clarification.examples.map((example, index) => {
          const content = <><span lang={clarification.language}>{example.sentence}</span><span className="clarification-meaning" lang="it">{example.meaning}</span></>;
          return onChoose ? <button type="button" className="clarification-example" key={index} disabled={disabled} onClick={() => onChoose(example.sentence)}>{content}</button> : <div className="clarification-example" key={index}>{content}</div>;
        })}
      </div>
      {onChoose && <p className="clarification-hint">Puoi scegliere un esempio oppure scrivere o dire quello che intendi.</p>}
    </>}
  </section>;
}
