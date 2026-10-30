import { client } from './api/client.gen';
import type { Message, StreamEvent } from './api/types.gen';

let csrf = '';
export function setCSRF(value: string) { csrf = value; }
client.setConfig({ baseUrl: '', credentials: 'same-origin' });
client.interceptors.request.use((request) => {
  if (csrf && !['GET', 'HEAD'].includes(request.method)) request.headers.set('X-CSRF-Token', csrf);
  return request;
});
client.interceptors.response.use((response) => {
  if (response.status === 401) window.dispatchEvent(new Event('lumi-session-expired'));
  return response;
});
export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Non riesco a connettermi. Controlla la connessione e riprova.';
}

// Explicitly no automatic retries: replaying a generation can spend plan usage twice.
export async function readStream(path: string, body: unknown, onEvent: (event: StreamEvent) => void, signal: AbortSignal) {
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('lumi-session-expired'));
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'La risposta non è disponibile. Riprova tra poco.');
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Risposta del server non valida.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder(); let buffer = ''; let terminal = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const event = JSON.parse(data) as StreamEvent;
        if (!['started', 'delta', 'images', 'sentence_map', 'topic_map', 'word_explanation', 'completed', 'failed'].includes(event.type)) throw new Error('Evento del server non valido.');
        onEvent(event);
        if (event.type === 'completed' || event.type === 'failed') terminal = true;
      }
      if (buffer.length > 100_000) throw new Error('Risposta troppo grande.');
      if (done) break;
    }
    if (!terminal) throw new Error('La risposta si è interrotta. Il testo già arrivato è ancora qui.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function shortDate(value: string) {
  return new Intl.DateTimeFormat('it', { day: 'numeric', month: 'short' }).format(new Date(value));
}

export function messageSpeechText(message: Message): string {
  const word = message.wordExplanation;
  return word ? [message.text, `${word.word}. ${word.meaning}`, word.example].filter(Boolean).join('\n') : message.text;
}

// Keep language boundaries for automatic reading and replay.
export function messageSpeechParts(message: Message): import('./speech').SpeechInput {
  const word = message.wordExplanation;
  if (!word?.exampleTranslation) {
    const map = message.sentenceMap;
    const part = map?.parts[0];
    if (map?.language && part) return [
      { text: message.text, language: 'it' },
      { text: part.text, language: map.language },
      ...(part.translation ? [{ text: part.translation, language: map.language === 'en' ? 'it' as const : 'en' as const }] : []),
    ];
    return messageSpeechText(message);
  }
  return [
    { text: message.text, language: 'it' },
    { text: word.word, language: 'en' },
    { text: word.meaning, language: 'it' },
    { text: word.example, language: 'en' },
    { text: word.exampleTranslation, language: 'it' },
  ];
}
