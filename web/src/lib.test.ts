import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStream, setCSRF } from './lib';
import type { StreamEvent } from './api/types.gen';

afterEach(() => { vi.unstubAllGlobals(); setCSRF(''); });
describe('streaming without retries', () => {
  it('decodes fragmented UTF-8 and waits for a terminal event', async () => {
    const bytes = new TextEncoder().encode(': keepalive\n\ndata: {"type":"delta","delta":"È una sorpresa!"}\n\ndata: {"type":"completed"}\n\n');
    const stream = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1)); controller.close(); } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock); setCSRF('test-csrf');
    const events: StreamEvent[] = [];
    await readStream('/api/test', {}, e => events.push(e), new AbortController().signal);
    expect(events).toEqual([{ type: 'delta', delta: 'È una sorpresa!' }, { type: 'completed' }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers['X-CSRF-Token']).toBe('test-csrf');
  });
  it('delivers image attachments even when the continuation is interrupted', async () => {
    const message = { id: 'one', conversationId: 'chat', role: 'assistant', text: '', status: 'streaming', createdAt: '', images: [{ title: 'Roccia', imageUrl: 'https://upload.wikimedia.org/rock.jpg', sourceUrl: '', creditUrl: '' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'images', message })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })));
    const events: StreamEvent[] = [];
    await expect(readStream('/test', {}, e => events.push(e), new AbortController().signal)).rejects.toThrow('interrotta');
    expect(events[0].message?.images?.[0].title).toBe('Roccia');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('keeps partial text and reports a truncated response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('data: {"type":"delta","delta":"Una parola"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })));
    const events: StreamEvent[] = [];
    await expect(readStream('/test', {}, e => events.push(e), new AbortController().signal)).rejects.toThrow('interrotta');
    expect(events[0].delta).toBe('Una parola');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('delivers a sentence map before a failed continuation', async () => {
    const message = { id: 'one', conversationId: 'chat', role: 'assistant', text: '', status: 'streaming', createdAt: '', sentenceMap: { sentence: 'La gatta dorme.', parts: [{ text: 'La gatta', question: 'Chi?', explanation: 'Una gatta.' }, { text: 'dorme.', question: 'Che cosa fa?', explanation: 'Riposa.' }] } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'sentence_map', message })}\n\ndata: ${JSON.stringify({ type: 'failed', message: { ...message, status: 'interrupted' }, error: { code: 'generation_failed', message: 'Interrotto' } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })));
    const events: StreamEvent[] = [];
    await readStream('/test', {}, e => events.push(e), new AbortController().signal);
    expect(events[0].message?.sentenceMap).toEqual(message.sentenceMap);
    expect(events[1].type).toBe('failed');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('surfaces a quota error without replaying the request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Piano esaurito' }), { status: 429 })));
    await expect(readStream('/test', {}, () => {}, new AbortController().signal)).rejects.toThrow('Piano esaurito');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('delivers a topic map before the final spoken text', async () => {
    const message = { id: 'map', conversationId: 'chat', role: 'assistant', status: 'streaming', text: '', createdAt: '', topicMap: { title: 'Spazio', branches: [{ label: 'Stelle', explanation: 'Fanno luce.', items: [{ label: 'Sole', explanation: 'La nostra stella.' }] }] } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'topic_map', message })}\n\ndata: ${JSON.stringify({ type: 'completed', message: { ...message, status: 'completed', text: 'Tocca un ramo.' } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })));
    const events: StreamEvent[] = [];
    await readStream('/test', {}, e => events.push(e), new AbortController().signal);
    expect(events[0].message?.topicMap).toEqual(message.topicMap);
    expect(events[1].message?.text).toBe('Tocca un ramo.');
  });
});
