import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WordExplanation } from './WordExplanation';
import { messageSpeechText, messageSpeechParts } from './lib';

afterEach(cleanup);
const explanation = { word: 'vigoroso', meaning: 'forte', example: 'Un calcio vigoroso fa volare il pallone.' };

it('shows meaning and example in separate visible cards and reads each part', () => {
  const onRead = vi.fn();
  const { rerender } = render(<WordExplanation explanation={explanation} onRead={onRead}/>);
  expect(within(screen.getByRole('region', { name: 'Significato' })).getByText('forte')).toBeVisible();
  expect(within(screen.getByRole('region', { name: 'Esempio' })).getByText(explanation.example)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Ascolta il significato' }));
  expect(onRead).toHaveBeenLastCalledWith('vigoroso. forte', 'meaning');
  fireEvent.click(screen.getByRole('button', { name: 'Ascolta l’esempio' }));
  expect(onRead).toHaveBeenLastCalledWith(explanation.example, 'example');
  rerender(<WordExplanation explanation={explanation} onRead={onRead} readingPart="example"/>);
  expect(within(screen.getByRole('region', { name: 'Esempio' })).getByRole('button', { name: 'Ferma la voce' })).toBeVisible();
});

it('renders model content as text and does not render absent cards', () => {
  const { container, rerender } = render(<WordExplanation/>);
  expect(container).toBeEmptyDOMElement();
  rerender(<WordExplanation explanation={{ ...explanation, meaning: '<img src=x onerror=alert(1)>' }}/>);
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  expect(container.querySelector('img')).toBeNull();
});

it('includes both cards in full-answer speech, including attachment-only answers', () => {
  const message = { id: 'one', conversationId: 'chat', role: 'assistant' as const, status: 'completed' as const, createdAt: '', text: '', wordExplanation: explanation };
  expect(messageSpeechText(message)).toBe(`vigoroso. forte\n${explanation.example}`);
  expect(messageSpeechText({ ...message, text: 'Ascoltiamo.', wordExplanation: undefined })).toBe('Ascoltiamo.');
});

it('shows English examples with Italian translations and passes explicit speech languages', () => {
  const onRead = vi.fn();
  const bilingual = { word: 'dog', meaning: 'cane', example: 'The dog is happy.', exampleTranslation: 'Il cane è felice.' };
  render(<WordExplanation explanation={bilingual} onRead={onRead}/>);
  expect(screen.getByRole('heading', { name: 'dog' })).toHaveAttribute('lang', 'en');
  expect(screen.getByText(bilingual.example)).toHaveAttribute('lang', 'en');
  expect(screen.getByText(bilingual.exampleTranslation)).toHaveAttribute('lang', 'it');
  fireEvent.click(screen.getByRole('button', { name: 'Ascolta il significato' }));
  expect(onRead).toHaveBeenLastCalledWith([{ text: 'dog', language: 'en' }, { text: 'cane', language: 'it' }], 'meaning');
  fireEvent.click(screen.getByRole('button', { name: 'Ascolta l’esempio' }));
  expect(onRead).toHaveBeenLastCalledWith([{ text: bilingual.example, language: 'en' }, { text: bilingual.exampleTranslation, language: 'it' }], 'example');
});

it('keeps bilingual segments for automatic answer playback', () => {
  const word = { word: 'dog', meaning: 'cane', example: 'The dog is happy.', exampleTranslation: 'Il cane è felice.' };
  expect(messageSpeechParts({ id: 'word', conversationId: 'english', role: 'assistant', status: 'completed', createdAt: '', text: '', wordExplanation: word })).toEqual([
    { text: '', language: 'it' }, { text: 'dog', language: 'en' }, { text: 'cane', language: 'it' },
    { text: 'The dog is happy.', language: 'en' }, { text: 'Il cane è felice.', language: 'it' },
  ]);
});
