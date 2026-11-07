import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { angleName, GeometryDrawing, LearningVisual } from './LearningVisual';
import { StudyClarification } from './StudyClarification';
import { messageSpeechParts, messageSpeechText, readStream } from './lib';
import type { GeometryVisual, Message, StreamEvent, StudyClarification as StudyClarificationData } from './api/types.gen';

const visual: GeometryVisual = { kind: 'geometry', title: 'Gli angoli', summary: 'Guarda quanto si aprono.', figures: [
  { shape: 'angle', label: 'Angolo retto', degrees: 90, explanation: 'Come un angolo del quaderno.' },
  { shape: 'angle', label: 'Angolo acuto', degrees: 45, explanation: 'Si apre meno di quello retto.' },
] };
const focus: StudyClarificationData = { topic: 'Gli Egiziani', question: 'Che cosa vuoi scoprire?', choices: [
  { label: 'Il Nilo', reply: 'Il Nilo' }, { label: 'Le piramidi', reply: 'Le piramidi' },
] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('keeps focus on a selected figure and reads just its explanation', () => {
  const onSelect = vi.fn(); const onRead = vi.fn();
  const { rerender } = render(<LearningVisual visual={visual} onSelect={onSelect} onRead={onRead}/>);
  expect(screen.getByRole('img', { name: 'Angolo retto: 90 gradi, angolo retto' })).toBeVisible();
  fireEvent.click(screen.getByRole('img', { name: 'Angolo retto: 90 gradi, angolo retto' }));
  expect(onSelect).toHaveBeenLastCalledWith('Angolo retto');
  expect(screen.getByText('Come un angolo del quaderno.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Ascolta' }));
  expect(onRead).toHaveBeenLastCalledWith('Angolo retto. Come un angolo del quaderno.', '0');
  rerender(<LearningVisual visual={structuredClone(visual)} onSelect={onSelect} onRead={onRead}/>);
  expect(screen.getByText('Come un angolo del quaderno.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Angolo acuto' }));
  expect(screen.queryByText('Come un angolo del quaderno.')).not.toBeInTheDocument();
  expect(screen.getByText('Si apre meno di quello retto.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Angolo acuto' }));
  expect(onSelect).toHaveBeenLastCalledWith('Angolo acuto');
});

it('derives angle classification from the measure, including zero, reflex and full turns', () => {
  for (const [degrees, label] of [[0, 'nullo'], [45, 'acuto'], [90, 'retto'], [135, 'ottuso'], [180, 'piatto'], [270, 'concavo'], [360, 'giro']] as const) {
    expect(angleName(degrees)).toBe(label);
    const { unmount } = render(<GeometryDrawing figure={{ shape: 'angle', label: 'Angolo', degrees, explanation: 'Guarda.' }}/>);
    expect(screen.getByRole('img')).toHaveAccessibleName(`Angolo: ${degrees} gradi, angolo ${label}`);
    unmount();
  }
});

it('draws a square from a single supplied dimension and supports basic shapes', () => {
  for (const shape of ['line', 'ray', 'segment', 'triangle', 'square', 'rectangle', 'circle'] as const) {
    const { container, unmount } = render(<GeometryDrawing figure={{ shape, label: shape, explanation: 'Guarda.', height: 70 }}/>);
    expect(screen.getByRole('img')).toHaveAccessibleName(shape);
    if (shape === 'square') { const rect = container.querySelector('rect')!; expect(rect.getAttribute('width')).toBe(rect.getAttribute('height')); }
    unmount();
  }
});

it('offers topic choices without asking for a display format and supports not knowing', () => {
  const onChoose = vi.fn();
  const { rerender } = render(<StudyClarification clarification={focus} onChoose={onChoose}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Il Nilo' }));
  expect(onChoose).toHaveBeenLastCalledWith('Il Nilo');
  fireEvent.click(screen.getByRole('button', { name: 'Non lo so' }));
  expect(onChoose.mock.lastCall?.[0]).toContain('senza chiedermi ancora');
  expect(screen.getByText('Puoi anche scrivere o dire un esempio.')).toBeVisible();
  rerender(<StudyClarification clarification={focus}/>);
  expect(screen.queryByRole('button')).toBeNull();
});

it('disables all study choices while an answer is being sent', () => {
  render(<StudyClarification clarification={focus} onChoose={vi.fn()} disabled/>);
  for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
});

it('renders diagram labels as text and opens one explanation at a time', () => {
  const { container } = render(<LearningVisual visual={{ kind: 'diagram', layout: 'cycle', title: '<script>test</script>', summary: 'Il ciclo dell’acqua.', nodes: [
    { id: 'cloud', label: 'Nuvola', explanation: 'Contiene goccioline.', symbol: 'cloud' },
    { id: 'rain', label: 'Pioggia', explanation: 'Le gocce cadono.', symbol: 'rain' },
  ], edges: [{ from: 'cloud', to: 'rain' }, { from: 'rain', to: 'cloud' }] }}/>);
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByRole('heading', { name: '<script>test</script>' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Nuvola' }));
  expect(screen.getByText('Contiene goccioline.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Pioggia' }));
  expect(screen.queryByText('Contiene goccioline.')).not.toBeInTheDocument();
  expect(screen.getByText('Le gocce cadono.')).toBeVisible();
});

it('loads cartography only from the shipped dataset and keeps text available on failure', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('Not found', { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<LearningVisual visual={{ kind: 'map', title: 'Un fiume', summary: 'L’acqua scorre.', datasetVersion: 'ne-v1', features: [{ id: 'rivers-test', label: 'Fiume', explanation: 'Un corso d’acqua.' }] }}/>);
  await screen.findByText(/Non riesco a caricare la cartina/);
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/geography/ne-v1/countries.json', '/geography/ne-v1/rivers.json']);
  expect(screen.getByText('Un corso d’acqua.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
});

it('reads a clarification and only a short introduction to a visual', () => {
  const message: Message = { id: 'x', conversationId: 'y', role: 'assistant', status: 'completed', text: '', createdAt: '', studyClarification: focus };
  expect(messageSpeechText(message)).toContain('Che cosa vuoi scoprire?\nIl Nilo\nLe piramidi');
  expect(messageSpeechParts(message)).toContain('Non lo so'.toLowerCase());
  message.studyClarification = undefined; message.learningVisual = visual;
  expect(messageSpeechParts(message)).toContain('Guarda quanto si aprono.');
  expect(messageSpeechParts(message)).not.toContain('Come un angolo del quaderno.');
  message.learningVisual = undefined; message.topicMap = { title: 'La vita dei Cretesi', branches: [] };
  expect(messageSpeechParts(message)).toBe('La vita dei Cretesi. Tocca un ramo per scoprire una piccola idea.');
});

it('accepts streamed study attachments and preserves them on an interrupted continuation', async () => {
  for (const type of ['study_clarification', 'learning_visual'] as const) {
    const message = { id: 'x', conversationId: 'y', role: 'assistant', status: 'streaming', text: '', createdAt: '', studyClarification: type === 'study_clarification' ? focus : undefined, learningVisual: type === 'learning_visual' ? visual : undefined };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type, message })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })));
    const events: StreamEvent[] = [];
    await expect(readStream('/test', {}, event => events.push(event), new AbortController().signal)).rejects.toThrow('interrotta');
    expect(events[0].message?.learningVisual ?? events[0].message?.studyClarification).toEqual(type === 'learning_visual' ? visual : focus);
  }
});
