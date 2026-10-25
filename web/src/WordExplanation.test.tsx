import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WordExplanation } from './WordExplanation';
import { messageSpeechText } from './lib';

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
