import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WordClarification } from './WordClarification';
import { messageSpeechParts, messageSpeechText } from './lib';
import type { WordClarification as WordClarificationData } from './api/types.gen';

const clarification: WordClarificationData = {
  word: 'bank', language: 'en', question: 'In quale frase hai trovato “bank”?',
  examples: [
    { sentence: 'I go to the bank.', meaning: 'La banca dove si tengono i soldi.' },
    { sentence: 'I sit on the river bank.', meaning: 'La riva del fiume.' },
  ],
};
afterEach(cleanup);

it('asks a question without inventing examples for the initial request', () => {
  render(<WordClarification clarification={{ ...clarification, examples: [] }}/>);
  expect(screen.getByText(clarification.question)).toBeVisible();
  expect(screen.queryByRole('button')).toBeNull();
});

it('offers touch and keyboard buttons only while the clarification is active', () => {
  const choose = vi.fn();
  const { rerender } = render(<WordClarification clarification={clarification} onChoose={choose}/>);
  fireEvent.click(screen.getByRole('button', { name: /I go to the bank/ }));
  expect(choose).toHaveBeenCalledWith('I go to the bank.');
  expect(screen.getByText('I go to the bank.')).toHaveAttribute('lang', 'en');
  expect(screen.getByText(clarification.examples[0].meaning)).toHaveAttribute('lang', 'it');
  rerender(<WordClarification clarification={clarification} onChoose={choose} disabled/>);
  expect(screen.getByRole('button', { name: /I go to the bank/ })).toBeDisabled();
  rerender(<WordClarification clarification={clarification}/>);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText(clarification.examples[0].sentence)).toBeVisible();
});

it('renders generated content as text in histories and previews', () => {
  const { container, rerender } = render(<WordClarification/>);
  expect(container).toBeEmptyDOMElement();
  rerender(<WordClarification clarification={{ ...clarification, question: '<img src=x onerror=alert(1)>' }}/>);
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  expect(container.querySelector('img')).toBeNull();
});

it('reads questions in Italian and example sentences in their source language', () => {
  const message = { id: 'one', conversationId: 'chat', role: 'assistant', text: '', status: 'completed', createdAt: '', wordClarification: clarification };
  expect(messageSpeechParts(message)).toEqual([
    { text: clarification.question, language: 'it' },
    { text: clarification.examples[0].sentence, language: 'en' },
    { text: clarification.examples[0].meaning, language: 'it' },
    { text: clarification.examples[1].sentence, language: 'en' },
    { text: clarification.examples[1].meaning, language: 'it' },
  ]);
  expect(messageSpeechText(message)).toContain(clarification.question);
  expect(messageSpeechText(message)).toContain(clarification.examples[1].sentence);
});
