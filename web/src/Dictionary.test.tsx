import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { DictionaryEntry } from './api/types.gen';
import { Dictionary } from './Dictionary';

afterEach(cleanup);
const words: DictionaryEntry[] = [
  { id: 'one', word: 'vigoroso', meaning: 'forte', example: 'Un calcio vigoroso fa volare il pallone.', firstAskedAt: '2026-10-25T12:00:00Z', lastAskedAt: '2026-10-25T12:00:00Z' },
  { id: 'two', word: 'arcobaleno', meaning: 'Un arco di colori nel cielo.', example: 'Dopo la pioggia appare un arcobaleno.', firstAskedAt: '2026-10-24T12:00:00Z', lastAskedAt: '2026-10-24T12:00:00Z' },
];

it('opens saved cards and searches words without case sensitivity', () => {
  render(<Dictionary words={words}/>);
  fireEvent.click(screen.getByRole('button', { name: /vigoroso Scoperta/ }));
  expect(screen.getByText('forte')).toBeVisible();
  expect(screen.getByText(words[0].example)).toBeVisible();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ARCO' } });
  expect(screen.getByRole('button', { name: /arcobaleno Scoperta/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: /vigoroso Scoperta/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
  expect(screen.getByRole('button', { name: 'Ripassiamo' })).toBeDisabled();
  expect(screen.getByText(/Nessuna parola trovata/)).toBeVisible();
});

it('reveals flashcards, repeats only requested words, and resets after leaving', () => {
  render(<Dictionary words={words}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Ripassiamo' }));
  expect(screen.getByRole('heading', { name: 'vigoroso' })).toBeVisible();
  expect(screen.queryByText('forte')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'La ricordo' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mostra il significato' }));
  expect(screen.getByText('forte')).toBeVisible();
  expect(screen.getByText(words[0].example)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Da ripassare' }));
  expect(screen.getByRole('heading', { name: 'arcobaleno' })).toBeVisible();
  expect(screen.queryByText(words[1].meaning)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mostra il significato' }));
  fireEvent.click(screen.getByRole('button', { name: 'La ricordo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ripassa ancora (1)' }));
  expect(screen.getByText('Parola 1 di 1')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'vigoroso' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Torna al dizionario' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ripassiamo' }));
  expect(screen.getByText('Parola 1 di 2')).toBeVisible();
  expect(screen.queryByText('forte')).not.toBeInTheDocument();
});

it('practices only the current search results and has an empty state', () => {
  const { rerender } = render(<Dictionary words={[]}/>);
  expect(screen.getByText('Le parole che chiedi a Lumi compariranno qui.')).toBeVisible();
  rerender(<Dictionary words={words}/>);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'arco' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ripassiamo' }));
  expect(screen.getByText('Parola 1 di 1')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'arcobaleno' })).toBeVisible();
});
