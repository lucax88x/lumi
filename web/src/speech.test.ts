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
