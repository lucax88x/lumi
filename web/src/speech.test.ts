import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSpeech } from './speech';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('prefers a local Italian voice and stops on unmount', () => {
  const italian = { voiceURI: 'local-it', lang: 'it-IT', localService: true } as SpeechSynthesisVoice;
  const speak = vi.fn(); const cancel = vi.fn();
  vi.stubGlobal('speechSynthesis', { getVoices: () => [italian], speak, cancel, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  const { result, unmount } = renderHook(() => useSpeech(0.9));
  act(() => result.current.speak('Ciao. Una parola alla volta.'));
  expect(speak.mock.calls[0][0].voice).toBe(italian);
  expect(speak.mock.calls[0][0].rate).toBe(0.9);
  act(() => speak.mock.calls[0][0].onstart());
  expect(result.current.speaking).toBe(true);
  unmount(); expect(cancel).toHaveBeenCalled();
});
it('shows a manual playback fallback when the browser never starts audio', () => {
  vi.useFakeTimers();
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'it', voiceURI: 'it', localService: true }], speak: vi.fn(), cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  const { result } = renderHook(() => useSpeech());
  act(() => result.current.speak('Ciao!'));
  act(() => vi.advanceTimersByTime(4001));
  expect(result.current.blocked).toBe(true);
  expect(result.current.speaking).toBe(false);
});

it('reads slowly with pauses between clauses, sentences and paragraphs', () => {
  vi.useFakeTimers();
  const speak = vi.fn();
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'it', voiceURI: 'it', localService: true }], speak, cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  const { result, unmount } = renderHook(() => useSpeech());
  act(() => result.current.speak('Ciao, piccola esploratrice. Leggiamo insieme.\nUna parola alla volta.'));
  expect(speak.mock.calls[0][0].rate).toBe(0.7);
  expect(speak.mock.calls[0][0].text).toBe('Ciao,');
  for (const [index, pause, nextText] of [[0, 300, 'piccola esploratrice.'], [1, 850, 'Leggiamo insieme.'], [2, 1200, 'Una parola alla volta.']] as const) {
    act(() => { speak.mock.calls[index][0].onstart(); speak.mock.calls[index][0].onend(); });
    expect(result.current.speaking).toBe(true);
    act(() => vi.advanceTimersByTime(pause - 1));
    expect(speak).toHaveBeenCalledTimes(index + 1);
    act(() => vi.advanceTimersByTime(1));
    expect(speak.mock.calls[index + 1][0].text).toBe(nextText);
  }
  act(() => { speak.mock.calls[3][0].onstart(); speak.mock.calls[3][0].onend(); });
  expect(result.current.speaking).toBe(false);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not resume a paused answer after stop or unmount', () => {
  vi.useFakeTimers();
  const speak = vi.fn();
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'it', voiceURI: 'it', localService: true }], speak, cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  const { result, unmount } = renderHook(() => useSpeech());
  act(() => result.current.speak('Prima frase. Seconda frase.'));
  const old = speak.mock.calls[0][0];
  act(() => { old.onstart(); old.onend(); result.current.stop(); });
  act(() => vi.advanceTimersByTime(2000));
  expect(speak).toHaveBeenCalledTimes(1);
  act(() => result.current.speak('Nuova frase. Altro pezzo.'));
  act(() => { old.onend(); speak.mock.calls[1][0].onstart(); speak.mock.calls[1][0].onend(); });
  unmount();
  act(() => vi.advanceTimersByTime(5000));
  expect(speak).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('tracks only the active answer through pauses, replacement, completion and errors', () => {
  vi.useFakeTimers();
  const speak = vi.fn();
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'it', voiceURI: 'it', localService: true }], speak, cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  const { result, unmount } = renderHook(() => useSpeech());
  act(() => result.current.speak('Prima frase. Seconda frase.', 'one'));
  expect(result.current.activeMessageId).toBe('one');
  const first = speak.mock.calls[0][0];
  act(() => { first.onstart(); first.onend(); });
  expect(result.current.activeMessageId).toBe('one');
  act(() => result.current.speak('Altra risposta.', 'two'));
  act(() => { first.onend(); vi.advanceTimersByTime(1000); });
  expect(speak).toHaveBeenCalledTimes(2);
  expect(result.current.activeMessageId).toBe('two');
  act(() => { speak.mock.calls[1][0].onstart(); speak.mock.calls[1][0].onend(); });
  expect(result.current.activeMessageId).toBeNull();
  act(() => result.current.speak('Errore.', 'three'));
  act(() => speak.mock.calls[2][0].onerror());
  expect(result.current.activeMessageId).toBeNull();
  expect(result.current.blocked).toBe(true);
  act(() => result.current.speak('Stop.', 'four'));
  act(() => result.current.stop());
  expect(result.current.activeMessageId).toBeNull();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('clears playback when the device throws, without interrupting the chat response', () => {
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'it', voiceURI: 'it', localService: true }], speak: () => { throw new Error('device failure'); }, cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  const { result, unmount } = renderHook(() => useSpeech());
  act(() => result.current.speak('Risposta completata.', 'one'));
  expect(result.current.activeMessageId).toBeNull();
  expect(result.current.speaking).toBe(false);
  expect(result.current.blocked).toBe(true);
  unmount();
});

it('switches English and Italian voices within an answer and honors each device preference', () => {
  vi.useFakeTimers();
  const italian = { voiceURI: 'local-it', lang: 'it-IT', localService: true } as SpeechSynthesisVoice;
  const english = { voiceURI: 'chosen-en', lang: 'en-US', localService: false } as SpeechSynthesisVoice;
  const localEnglish = { voiceURI: 'local-en', lang: 'en-GB', localService: true } as SpeechSynthesisVoice;
  const speak = vi.fn();
  localStorage.setItem('lumi-voice-en', english.voiceURI);
  vi.stubGlobal('speechSynthesis', { getVoices: () => [italian, localEnglish, english], speak, cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  const { result, unmount } = renderHook(() => useSpeech());
  act(() => result.current.speak([{ text: 'dog', language: 'en' }, { text: 'cane', language: 'it' }], 'word'));
  expect(speak.mock.calls[0][0].voice).toBe(english);
  expect(speak.mock.calls[0][0].lang).toBe('en-US');
  act(() => { speak.mock.calls[0][0].onstart(); speak.mock.calls[0][0].onend(); vi.advanceTimersByTime(1200); });
  expect(speak.mock.calls[1][0].voice).toBe(italian);
  expect(speak.mock.calls[1][0].text).toBe('cane');
  expect(result.current.activeMessageId).toBe('word');
  unmount(); localStorage.removeItem('lumi-voice-en');
});

it('reports the missing English voice without reading English with an Italian voice', () => {
  const speak = vi.fn();
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ voiceURI: 'it', lang: 'it-IT' }], speak, cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const { result } = renderHook(() => useSpeech());
  act(() => result.current.speak([{ text: 'dog', language: 'en' }], 'english'));
  expect(speak).not.toHaveBeenCalled();
  expect(result.current.missingLanguage).toBe('en');
  expect(result.current.blocked).toBe(true);
  expect(result.current.speaking).toBe(false);
});

it('accepts device locale tags with underscores for Italian and English', () => {
  vi.useFakeTimers();
  const italian = { voiceURI: 'it', lang: 'it_IT', localService: true } as SpeechSynthesisVoice;
  const english = { voiceURI: 'en', lang: 'en_US', localService: true } as SpeechSynthesisVoice;
  const speak = vi.fn();
  vi.stubGlobal('speechSynthesis', { getVoices: () => [italian, english], speak, cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  const { result, unmount } = renderHook(() => useSpeech());
  expect(result.current.voices).toEqual([italian, english]);
  act(() => result.current.speak([{ text: 'Ciao!', language: 'it' }, { text: 'Hello!', language: 'en' }]));
  expect(speak.mock.calls[0][0].voice).toBe(italian);
  expect(speak.mock.calls[0][0].lang).toBe('it-IT');
  act(() => { speak.mock.calls[0][0].onstart(); speak.mock.calls[0][0].onend(); vi.advanceTimersByTime(1200); });
  expect(speak.mock.calls[1][0].voice).toBe(english);
  expect(speak.mock.calls[1][0].lang).toBe('en-US');
  unmount();
});

it('refreshes voices at playback when the browser misses voiceschanged', () => {
  const italian = { voiceURI: 'it', lang: 'it-IT' } as SpeechSynthesisVoice;
  let voices: SpeechSynthesisVoice[] = [];
  const speak = vi.fn();
  vi.stubGlobal('speechSynthesis', { getVoices: () => voices, speak, cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  const { result, unmount } = renderHook(() => useSpeech());
  voices = [italian];
  act(() => result.current.speak('Ciao!'));
  expect(speak.mock.calls[0][0].voice).toBe(italian);
  expect(result.current.voices).toEqual([italian]);
  expect(result.current.blocked).toBe(false);
  unmount();
});

it('retries initially empty voice discovery for a bounded time and cleans up on unmount', () => {
  vi.useFakeTimers();
  const italian = { voiceURI: 'it', lang: 'it-IT' } as SpeechSynthesisVoice;
  let voices: SpeechSynthesisVoice[] = [];
  vi.stubGlobal('speechSynthesis', { getVoices: () => voices, cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const first = renderHook(() => useSpeech());
  act(() => vi.advanceTimersByTime(5000));
  expect(vi.getTimerCount()).toBe(0);
  first.unmount();
  const second = renderHook(() => useSpeech());
  voices = [italian];
  act(() => vi.advanceTimersByTime(250));
  expect(second.result.current.voices).toEqual([italian]);
  second.unmount();
  expect(vi.getTimerCount()).toBe(0);
  voices = [];
  const third = renderHook(() => useSpeech());
  third.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['it', 'en'] as const)('lets the browser resolve a %s voice when enumeration is empty', language => {
  vi.useFakeTimers();
  const speak = vi.fn();
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], speak, cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  const { result, unmount } = renderHook(() => useSpeech());
  act(() => result.current.speak([{ text: language === 'it' ? 'Ciao!' : 'Hello!', language }]));
  expect(speak).toHaveBeenCalledTimes(1);
  expect(speak.mock.calls[0][0].lang).toBe(language === 'it' ? 'it-IT' : 'en-US');
  expect(speak.mock.calls[0][0].voice).toBeUndefined();
  act(() => speak.mock.calls[0][0].onstart());
  expect(result.current.blocked).toBe(false);
  expect(result.current.missingLanguage).toBeNull();
  unmount();
});

it.each(['language-unavailable', 'voice-unavailable', 'not-allowed', 'audio-busy'])('distinguishes %s from voice discovery failures', error => {
  vi.useFakeTimers();
  const speak = vi.fn();
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], speak, cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  const { result, unmount } = renderHook(() => useSpeech());
  act(() => result.current.speak([{ text: 'Hello!', language: 'en' }]));
  act(() => speak.mock.calls[0][0].onerror({ error }));
  expect(result.current.blocked).toBe(true);
  expect(result.current.missingLanguage).toBe(['language-unavailable', 'voice-unavailable'].includes(error) ? 'en' : null);
  expect(result.current.speaking).toBe(false);
  unmount();
});
