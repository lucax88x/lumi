import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SentenceMap } from './SentenceMap';
import type { SentenceMap as SentenceMapData } from './api/types.gen';

const map: SentenceMapData = { sentence: 'La gatta dorme.', parts: [
  { text: 'La gatta', question: 'Chi?', explanation: 'Si parla di una gatta.' },
  { text: 'dorme.', question: 'Che cosa fa?', explanation: 'Sta riposando.' },
] };
afterEach(cleanup);

it('opens one explanation at a time and reads only the selected piece', () => {
  const onRead = vi.fn(); const onSelect = vi.fn();
  render(<SentenceMap map={map} onRead={onRead} onSelect={onSelect}/>);
  expect(screen.getByText('Si parla di una gatta.')).toBeVisible();
  expect(screen.getByText('Sta riposando.')).not.toBeVisible();
  const second = screen.getByRole('button', { name: /Che cosa fa/ });
  fireEvent.click(second);
  expect(second).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Si parla di una gatta.')).not.toBeVisible();
  expect(screen.getByText('Sta riposando.')).toBeVisible();
  expect(onSelect).toHaveBeenCalledWith(1);
  fireEvent.click(screen.getByRole('button', { name: 'Ascolta il pezzetto' }));
  expect(onRead).toHaveBeenCalledWith('dorme. Sta riposando.', 1);
  fireEvent.click(second);
  expect(screen.getByText('Sta riposando.')).not.toBeVisible();
  expect(onSelect).toHaveBeenLastCalledWith(null);
});

it('preserves selection across stream updates and resets for a new map', () => {
  const { rerender } = render(<SentenceMap map={map}/>);
  fireEvent.click(screen.getByRole('button', { name: /Che cosa fa/ }));
  rerender(<SentenceMap map={structuredClone(map)}/>);
  expect(screen.getByText('Sta riposando.')).toBeVisible();
  rerender(<SentenceMap map={{ ...map, sentence: 'Un’altra frase.' }}/>);
  expect(screen.getByText('Si parla di una gatta.')).toBeVisible();
});

it('does not show an empty map and renders model text without HTML', () => {
  const { container, rerender } = render(<SentenceMap/>);
  expect(container).toBeEmptyDOMElement();
  rerender(<SentenceMap map={{ ...map, sentence: '<img src=x onerror=alert(1)>' }}/>);
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  expect(container.querySelector('img')).toBeNull();
});
