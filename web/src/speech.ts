import { useCallback, useEffect, useRef, useState } from 'react';

export type SpeechPart = { text: string; language: 'it' | 'en' };
export type SpeechInput = string | SpeechPart[];

function voiceLocale(voice: SpeechSynthesisVoice) {
  return voice.lang.replace(/_/g, '-');
}

export function useSpeech(rate = 0.7) {
  const [speaking, setSpeaking] = useState(false);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [missingLanguage, setMissingLanguage] = useState<'it' | 'en' | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const serial = useRef(0);
  const pauseTimer = useRef<number | undefined>(undefined);
  const startTimer = useRef<number | undefined>(undefined);
  const refreshVoices = useCallback(() => {
    const available = window.speechSynthesis?.getVoices() ?? [];
    setVoices(available.filter(v => /^(it|en)(-|$)/i.test(voiceLocale(v))));
    return available;
  }, []);
  const stop = useCallback(() => {
    serial.current++;
    clearTimeout(pauseTimer.current); clearTimeout(startTimer.current);
    window.speechSynthesis?.cancel(); setSpeaking(false); setActiveMessageId(null);
  }, []);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    let retryTimer: number | undefined;
    let attempts = 0;
    const update = () => {
      clearTimeout(retryTimer);
      // Some browsers populate voices late without sending voiceschanged.
      if (refreshVoices().length === 0 && attempts++ < 16) retryTimer = window.setTimeout(update, 250);
    };
    synth.addEventListener('voiceschanged', update); update();
    const hide = () => { if (document.hidden) stop(); else update(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('focus', update);
    return () => { clearTimeout(retryTimer); synth.removeEventListener('voiceschanged', update); document.removeEventListener('visibilitychange', hide); window.removeEventListener('focus', update); stop(); };
  }, [refreshVoices, stop]);
  const speak = useCallback((input: SpeechInput, messageId?: string) => {
    stop(); setBlocked(false); setMissingLanguage(null);
    const current = serial.current;
    const segments: SpeechPart[] = typeof input === 'string' ? [{ text: input, language: 'it' }] : input;
    const parts = segments.flatMap(segment => {
      const segmenter = new Intl.Segmenter(segment.language, { granularity: 'sentence' });
      return segment.text.replace(/[*#`]/g, '').split(/\n+/).flatMap(paragraph => {
        const sentences = [...segmenter.segment(paragraph)].map(part => part.segment.trim()).filter(Boolean);
        return sentences.flatMap((sentence, sentenceIndex) => {
          const clauses = sentence.split(/(?<=[,;:])\s+/u);
          return clauses.map((text, clauseIndex) => ({
            text, language: segment.language,
            pauseAfter: clauseIndex < clauses.length - 1 ? 300 : sentenceIndex < sentences.length - 1 ? 850 : 1200,
          }));
        });
      });
    });
    if (parts.length === 0) return;
    setActiveMessageId(messageId ?? null); setSpeaking(true);
    const next = (index: number) => {
      if (serial.current !== current) return;
      if (index >= parts.length) { setSpeaking(false); setActiveMessageId(null); return; }
      const language = parts[index].language;
      if (!window.speechSynthesis) { stop(); setBlocked(true); return; }
      const deviceVoices = refreshVoices();
      const available = deviceVoices.filter(voice => voiceLocale(voice).toLowerCase().split('-')[0] === language);
      if (deviceVoices.length > 0 && available.length === 0) { stop(); setBlocked(true); setMissingLanguage(language); return; }
      let preferred = '';
      try { preferred = localStorage.getItem(language === 'it' ? 'lumi-voice' : 'lumi-voice-en') ?? ''; } catch { /* optional preference */ }
      const voice = available.find(v => v.voiceURI === preferred) ?? available.find(v => v.localService) ?? available[0];
      try {
        const utterance = new SpeechSynthesisUtterance(parts[index].text);
        // An empty inventory can mean discovery is still pending. Let the engine
        // resolve the requested language instead of treating it as uninstalled.
        utterance.lang = voice ? voiceLocale(voice) : language === 'it' ? 'it-IT' : 'en-US';
        utterance.rate = rate;
        if (voice) utterance.voice = voice;
        let started = false;
        const watchdog = window.setTimeout(() => {
          if (!started && serial.current === current) { stop(); setBlocked(true); }
        }, 4000);
        startTimer.current = watchdog;
        utterance.onstart = () => { started = true; clearTimeout(watchdog); if (current === serial.current) setSpeaking(true); };
        utterance.onend = () => {
          clearTimeout(watchdog);
          if (current !== serial.current) return;
          if (index + 1 >= parts.length) { setSpeaking(false); setActiveMessageId(null); return; }
          pauseTimer.current = window.setTimeout(() => next(index + 1), parts[index].pauseAfter);
        };
        utterance.onerror = event => {
          clearTimeout(watchdog);
          if (current !== serial.current) return;
          stop(); setBlocked(true);
          if (event?.error === 'language-unavailable' || event?.error === 'voice-unavailable') setMissingLanguage(language);
        };
        window.speechSynthesis.speak(utterance);
      } catch { if (current === serial.current) { stop(); setBlocked(true); } }
    };
    next(0);
  }, [rate, refreshVoices, stop]);
  return { speak, stop, speaking, activeMessageId, blocked, missingLanguage, voices };
}
