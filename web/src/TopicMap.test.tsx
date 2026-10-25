import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TopicMap } from './TopicMap';
import type { TopicMap as TopicMapData } from './api/types.gen';

const map: TopicMapData = { title: 'Il Sistema solare', branches: [
  { label: 'Pianeti', explanation: 'Gli otto pianeti girano intorno al Sole.', items: ['Mercurio', 'Venere', 'Terra', 'Marte', 'Giove', 'Saturno', 'Urano', 'Nettuno'].map(label => ({ label, explanation: `${label} è un pianeta.` })) },
  { label: 'Altri corpi', explanation: 'Ci sono anche piccoli corpi.', items: [{ label: 'Meteorite', explanation: 'Un frammento arrivato al suolo.' }] },
] };
afterEach(cleanup);

it('shows all eight planets and opens one branch and one item at a time', () => {
  const onSelect = vi.fn(); const onRead = vi.fn();
  const { rerender } = render(<TopicMap map={map} onSelect={onSelect} onRead={onRead}/>);
  expect(screen.getByRole('button', { name: 'Pianeti' })).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Pianeti' }));
  for (const item of map.branches[0].items) expect(screen.getByRole('button', { name: item.label })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Marte' }));
  expect(onSelect).toHaveBeenLastCalledWith({ branch: 'Pianeti', label: 'Marte' });
  expect(screen.getByText('Marte è un pianeta.')).toBeVisible();
  rerender(<TopicMap map={structuredClone(map)} onSelect={onSelect} onRead={onRead}/>);
  expect(screen.getByText('Marte è un pianeta.')).toBeVisible();
  const detail = screen.getByText('Marte è un pianeta.').parentElement!;
  fireEvent.click(detail.querySelector('button')!);
  expect(onRead).toHaveBeenLastCalledWith('Marte. Marte è un pianeta.', '0.3');
  fireEvent.click(screen.getByRole('button', { name: 'Venere' }));
  expect(screen.getByText('Marte è un pianeta.')).not.toBeVisible();
  expect(screen.getByText('Venere è un pianeta.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Altri corpi' }));
  expect(screen.getByRole('button', { name: 'Pianeti' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('button', { name: 'Marte' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Meteorite' }));
  expect(screen.getByText('Un frammento arrivato al suolo.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Altri corpi' }));
  expect(onSelect).toHaveBeenLastCalledWith(null);
});

it('does not render an empty map and treats model content as text', () => {
  const { container, rerender } = render(<TopicMap/>);
  expect(container).toBeEmptyDOMElement();
  rerender(<TopicMap map={{ ...map, title: '<img src=x onerror=alert(1)>' }}/>);
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  expect(container.querySelector('img')).toBeNull();
});
