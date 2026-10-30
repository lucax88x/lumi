import { useCallback, useEffect, useRef, useState } from 'react';

export type SpeechPart = { text: string; language: 'it' | 'en' };
export type SpeechInput = string | SpeechPart[];

export function useSpeech(rate = 0.7) {
  const [speaking, setSpeaking] = useState(false);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [missingLanguage, setMissingLanguage] = useState<'it' | 'en' | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const serial = useRef(0);
  const pauseTimer = useRef<number | undefined>(undefined);
  const startTimer = useRef<number | undefined>(undefined);
  const stop = useCallback(() => {
    serial.current++;
    clearTimeout(pauseTimer.current); clearTimeout(startTimer.current);
    window.speechSynthesis?.cancel(); setSpeaking(false); setActiveMessageId(null);
  }, []);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const update = () => setVoices(synth.getVoices().filter(v => /^(it|en)(-|$)/i.test(v.lang)));
    update(); synth.addEventListener('voiceschanged', update);
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hide);
    return () => { synth.removeEventListener('voiceschanged', update); document.removeEventListener('visibilitychange', hide); stop(); };
  }, [stop]);
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
      const available = voices.filter(voice => voice.lang.toLowerCase().startsWith(language));
      if (!window.speechSynthesis || available.length === 0) { stop(); setBlocked(true); setMissingLanguage(language); return; }
      let preferred = '';
      try { preferred = localStorage.getItem(language === 'it' ? 'lumi-voice' : 'lumi-voice-en') ?? ''; } catch { /* optional preference */ }
      const voice = available.find(v => v.voiceURI === preferred) ?? available.find(v => v.localService) ?? available[0];
      try {
        const utterance = new SpeechSynthesisUtterance(parts[index].text);
        utterance.lang = voice.lang; utterance.rate = rate; utterance.voice = voice;
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
        utterance.onerror = () => { clearTimeout(watchdog); if (current === serial.current) { stop(); setBlocked(true); } };
        window.speechSynthesis.speak(utterance);
      } catch { if (current === serial.current) { stop(); setBlocked(true); } }
    };
    next(0);
  }, [rate, stop, voices]);
  return { speak, stop, speaking, activeMessageId, blocked, missingLanguage, voices };
}
